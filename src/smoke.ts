import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { games } from './registry.ts';
import { replayLocalAudit, runLocalEpisode } from './local-runner.ts';
import type { GameAdapter } from './types.ts';

export interface SmokeOptions { outputDir?: string; maxActions?: number; clockStepMs?: number; repeats?: number; seedPrefix?: string; gameId?: string; examples?: number }
export async function smokeAll(options: SmokeOptions = {}, catalogue: GameAdapter[] = games) {
  const outputDir = resolve(options.outputDir ?? 'artifacts'); await mkdir(outputDir, { recursive: true });
  const selected = options.gameId ? catalogue.filter(game => game.metadata.id === options.gameId) : catalogue;
  if (!selected.length) throw new Error(`No registered game matches ${options.gameId ?? 'catalogue'}.`);
  const repeats = options.repeats ?? 1; const exampleLimit = options.examples ?? 3;
  if (!Number.isSafeInteger(repeats) || repeats < 1 || !Number.isSafeInteger(exampleLimit) || exampleLimit < 0) throw new Error('repeats must be positive and examples nonnegative.');
  const rows: Record<string, unknown>[] = []; const exampleFiles: string[] = []; const exampleGames = new Set<string>();
  for (const game of selected) for (const scenario of game.metadata.scenarios) for (const playerCount of game.metadata.players) for (let repeat = 0; repeat < repeats; repeat++) {
    const identity = `${game.metadata.id}/${scenario.id}/${playerCount}/${repeat}`;
    try {
      const result = await runLocalEpisode(game, {
        setup: { playerCount, scenarioId: scenario.id, seed: `${options.seedPrefix ?? 'mechanical-smoke-v1'}/${identity}` },
        maxActions: options.maxActions ?? 500, clockStepMs: options.clockStepMs ?? 1000,
        purpose: 'mechanical-smoke', policyName: 'mechanical-first-example',
      });
      const replay = replayLocalAudit(game, result.audit);
      rows.push({ identity, partitionFamily: result.partitionFamily, gameId: game.metadata.id, scenarioId: scenario.id, playerCount, repeat, status: result.terminated ? 'terminated' : 'truncated', actions: result.actions, timeAdvances: result.timeAdvances, simulatedElapsedMs: result.simulatedElapsedMs, outcome: result.outcome, truncationReason: result.truncationReason, replayVerified: replay.verified });
      if (exampleFiles.length < exampleLimit && !exampleGames.has(game.metadata.id)) {
        const file = `local-trajectory-${game.metadata.id}.json`;
        await writeFile(resolve(outputDir, file), JSON.stringify({ warning: 'Privileged local replay example. Includes setup seed and all action records; never supply this whole file to a player policy. No API player tokens are used.', audit: result.audit, trainingRows: result.trainingRows }, null, 2) + '\n');
        exampleFiles.push(file); exampleGames.add(game.metadata.id);
      }
    } catch (error) { rows.push({ identity, gameId: game.metadata.id, scenarioId: scenario.id, playerCount, repeat, status: 'error', error: error instanceof Error ? error.message : String(error) }); }
  }
  const report = {
    schemaVersion: 'coop-bench/smoke-report/v1', purpose: 'mechanical-smoke', generatedAt: new Date().toISOString(),
    warning: 'Legal-action plumbing and deterministic replay checks only. These outcomes are not agent intelligence, official communication compliance, or The Mind timing-policy evidence. Budget exhaustion is truncation, never a game loss.',
    settings: { repeats, maxActions: options.maxActions ?? 500, clockStepMs: options.clockStepMs ?? 1000 },
    totals: { combinations: rows.length, terminated: rows.filter(row => row.status === 'terminated').length, truncated: rows.filter(row => row.status === 'truncated').length, errors: rows.filter(row => row.status === 'error').length },
    exampleFiles, runs: rows,
  };
  const reportPath = resolve(outputDir, 'smoke-report.json'); await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  return { reportPath, report };
}
async function main() {
  const args = process.argv.slice(2); const options: SmokeOptions = {};
  const names: Record<string, keyof SmokeOptions> = { '--out-dir': 'outputDir', '--max-actions': 'maxActions', '--clock-step-ms': 'clockStepMs', '--repeats': 'repeats', '--seed-prefix': 'seedPrefix', '--game': 'gameId', '--examples': 'examples' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { process.stdout.write('node src/smoke.ts [--out-dir artifacts] [--max-actions 500] [--clock-step-ms 1000] [--repeats 1] [--seed-prefix text] [--game id] [--examples 3]\n'); return; }
    const key = names[args[i]]; if (!key || i + 1 === args.length || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    const value = args[++i]; (options as Record<string, unknown>)[key] = ['maxActions', 'clockStepMs', 'repeats', 'examples'].includes(key) ? Number(value) : value;
  }
  const { reportPath, report } = await smokeAll(options); process.stdout.write(JSON.stringify({ reportPath, ...report.totals }, null, 2) + '\n');
  if (report.totals.errors) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
