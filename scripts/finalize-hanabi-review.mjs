// Authorized human review, after gameplay and artifact upload have completed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cloudFetch } from './cloud-http-client.mjs';
import { redact } from './hanabi-demo.mjs';
import { reassembleCapture } from './agent-message-recorder.mjs';

const folder = new URL('../artifacts/hanabi-demo/', import.meta.url);
const report = JSON.parse(readFileSync(new URL('relay-audit.json', folder), 'utf8'));
const verification = JSON.parse(readFileSync(new URL('verification.json', folder), 'utf8'));
assert.equal(report.result, 'passed-with-capture-limitations');
assert.equal(report.episodeId, verification.episodeId);
assert.equal(verification.artifacts.length, 6);
assert.ok(verification.artifacts.every(item => item.sha256Valid));
const token = readFileSync(new URL('../artifacts/cloud-private/owner.txt', import.meta.url), 'utf8').trim();
const base = 'https://coop.neutrinophysics.cn/api/v1', id = report.episodeId;
async function request(path, body) {
  const response = await cloudFetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Review request failed: HTTP ${response.status}`);
  return response.json();
}
const rollout = await request(`/rollouts/${id}`);
assert.equal(rollout.summary.status, 'completed');
assert.deepEqual(rollout.summary.outcome, report.outcome);
const registry = await request('/games');
assert.ok(Array.isArray(registry.games) && registry.games.some(game => game.id === 'hanabi'));
const messages = await request(`/rollouts/${id}/messages`);
assert.equal(messages.seats.length, 3);
const messageChecks = [];
for (const seat of messages.seats) {
  assert.equal(seat.completion?.completeness, 'partial');
  assert.equal(seat.completion?.reasoningAvailability, 'not-provided');
  const envelopes = []; let after = -1;
  while (true) {
    const page = await request(`/rollouts/${id}/messages?playerId=${seat.playerId}&after=${after}&limit=100`);
    envelopes.push(...page.messages);
    if (!page.hasMore) break;
    assert.ok(page.nextAfter > after, 'Message cursor failed to advance'); after = page.nextAfter;
  }
  assert.equal(envelopes.length, seat.messageCount);
  const groups = new Map();
  for (const [sequence, envelope] of envelopes.entries()) {
    assert.equal(envelope.sequence, sequence);
    const key = envelope.requestId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(envelope);
  }
  const transcript = readFileSync(new URL(`../artifacts/cloud-private/hanabi-demo/${seat.playerId}/transcript.jsonl`, import.meta.url), 'utf8')
    .trim().split('\n').map(JSON.parse).filter(entry => entry.type !== 'session');
  assert.equal(groups.size, transcript.length);
  for (const entry of transcript) {
    assert.ok(groups.has(entry.eventId), 'Captured event missing from server message stream');
    assert.deepEqual(reassembleCapture(groups.get(entry.eventId)), entry.raw, 'Server message differs from original capture');
  }
  messageChecks.push({ playerId: seat.playerId, envelopeCount: envelopes.length, exactCapturesVerified: transcript.length });
}
const training = await request(`/episodes/${id}/training`);
assert.equal(training.rows.length, report.actionCount);
const expectedReward = report.outcome.kind === 'score-only' ? report.outcome.score / report.outcome.maxScore : Number(report.outcome.success);
assert.equal(training.terminalTeamReward, expectedReward);
assert.equal(training.rewardPolicy, 'terminal-team-win-or-normalized-score-v1');
writeFileSync(new URL('training-redacted.json', folder), JSON.stringify(redact(training), null, 2) + '\n');
writeFileSync(new URL('messages-summary.json', folder), JSON.stringify(messages, null, 2) + '\n');
writeFileSync(new URL('messages-exact-verification.json', folder), JSON.stringify(messageChecks, null, 2) + '\n');
const hints = Object.values(report.counts).reduce((sum, seat) => sum + seat.publicHints, 0);
const marker = '[Hanabi relay audit v1]';
const text = `${marker}\n三位独立子智能体的一次未挑选随机发牌，${report.actionCount} 个动作，合法提示 ${hints} 次。` +
  `服务端终局：${report.outcome.score}/25，类型 ${report.outcome.kind}，失误 ${report.finalErrors} 次。` +
  `逐步核对通过：玩家输入等于该座位的原始观察，自己牌面与牌库隐藏，原始回复与实际动作一致，只有规则允许的提示交流，计分与完整重放一致。` +
  `三位玩家的赛中原始可见 messages、工具请求/回执已保存并封存，逐条读回重组后与原始捕获一致；6 份原始附件上传后逐一下载，大小与 SHA-256 一致。` +
  `\n审计边界：未见所录轨迹中的违规通信或替换动作，但这不是运行时无作弊证明。未取得供应商内部提示、隐藏 thinking、token IDs/用量或传递器外工具调用日志；未伪造这些内容。` +
  `decisionSummary 是赛中简短说明，不是隐藏思考。玩家使用独立新上下文，但没有独立操作系统沙箱。采集诚实标注 partial / not-provided。` +
  `\n训练导出：${training.rewardPolicy}，terminalTeamReward=${training.terminalTeamReward}。轨迹未经专家质量筛选，不能直接视为高质量 SFT 示范。`;
const existing = rollout.annotations.filter(note => note.text.startsWith(marker));
assert.ok(existing.length <= 1, 'Duplicate review markers require inspection');
if (existing.length) assert.equal(existing[0].text, text, 'Existing audit note differs; do not overwrite');
const annotation = existing[0] ?? await request(`/rollouts/${id}/annotations`, { kind: 'review', text });
const fresh = await request(`/rollouts/${id}`);
assert.ok(fresh.annotations.some(note => note.id === annotation.id && note.text === text));
const independentMarker = '[Hanabi independent review v1]';
const independentText = `${independentMarker}\n` + readFileSync(new URL('../docs/hanabi-agent-demo-review.md', import.meta.url), 'utf8').trim();
assert.ok(independentText.includes(id), 'Independent review must refer to this episode');
assert.ok(independentText.length <= 20000, 'Independent review exceeds annotation limit');
const independentNotes = fresh.annotations.filter(note => note.text.startsWith(independentMarker));
assert.ok(independentNotes.length <= 1, 'Duplicate independent review markers require inspection');
if (independentNotes.length) assert.equal(independentNotes[0].text, independentText, 'Existing independent review differs; do not overwrite');
const independentNote = independentNotes[0] ?? await request(`/rollouts/${id}/annotations`, { kind: 'review', text: independentText });
const reviewed = await request(`/rollouts/${id}`);
assert.ok(reviewed.annotations.some(note => note.id === independentNote.id && note.text === independentText));
const result = { episodeId: id, annotationId: annotation.id, checkedAt: new Date().toISOString(),
  independentAnnotationId: independentNote.id, independentReviewVerified: true,
  registeredGames: registry.games.map(game => ({ id: game.id, name: game.name })),
  score: report.outcome.score, terminalTeamReward: training.terminalTeamReward,
  messages: messages.seats.map(seat => ({ playerId: seat.playerId, envelopeCount: seat.messageCount,
    completeness: seat.completion.completeness, reasoningAvailability: seat.completion.reasoningAvailability })),
  completedArtifacts: 6, messageChecks, noteVerified: true };
writeFileSync(new URL('review-upload.json', folder), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
