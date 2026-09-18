import { createHash, createHmac } from 'node:crypto';
import type { Action, JsonObject, LegalAction } from './types.ts';

export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RuleError'; this.code = code; }
}
export function check(condition: unknown, message: string, code = 'ILLEGAL_ACTION'): asserts condition {
  if (!condition) throw new RuleError(code, message);
}
export function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
export function exactKeys(value: unknown, allowed: string[]): asserts value is JsonObject {
  check(object(value), 'Expected a plain JSON object.');
  check(Object.keys(value).every(key => allowed.includes(key)), `Only these fields are allowed: ${allowed.join(', ')}.`);
}
export function actionKeys(action: Action, type: string, fields: string[] = []): void {
  exactKeys(action, ['type', ...fields]); check(action.type === type, `Expected action ${type}.`);
}
export function integer(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
}
export function players(count: number): string[] { return Array.from({ length: count }, (_, i) => `p${i + 1}`); }
export function nextPlayer(ids: string[], current: string): string { return ids[(ids.indexOf(current) + 1) % ids.length]; }
export const RANDOM_VERSION = 'hmac-sha256-counter-rejection-v1';
export interface RngState { key: string; counter: number }
/** Seeds and RNG state are privileged. Online creation generates 256 random bits. */
export function makeRng(seed: string): RngState {
  return { key: createHash('sha256').update('coop-bench/random/v1\0').update(seed).digest('hex'), counter: 0 };
}
export function randomInt(rng: RngState, upper: number): number {
  check(Number.isInteger(upper) && upper > 0 && upper <= 0x100000000, 'Invalid random range.', 'INTERNAL');
  const limit = Math.floor(0x100000000 / upper) * upper;
  for (;;) {
    check(Number.isSafeInteger(rng.counter) && rng.counter >= 0, 'Random stream exhausted.', 'INTERNAL');
    const value = createHmac('sha256', Buffer.from(rng.key, 'hex'))
      .update(`draw:${rng.counter++}`).digest().readUInt32BE(0);
    if (value < limit) return value % upper;
  }
}
export function shuffle<T>(items: readonly T[], rng: RngState): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = randomInt(rng, i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
export function clone<T>(state: T): T { return structuredClone(state); }
export function schema(type: string, properties: JsonObject = {}, required: string[] = Object.keys(properties)): JsonObject {
  return { type: 'object', properties: { type: { const: type }, ...properties }, required: ['type', ...required], additionalProperties: false };
}
export function legal(type: string, description: string, properties: JsonObject = {}, required?: string[], examples?: Action[]): LegalAction {
  return { type, description, schema: schema(type, properties, required), ...(examples ? { examples } : {}) };
}
export function textValue(value: unknown, max = 200): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function normalizeWord(value: string): string { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').trim(); }
