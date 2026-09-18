/**
 * Executable design counterexample, not a game server or production crypto format.
 * A valid encrypted state can be replayed into two valid branches.
 * The Map models a serialized authority only; it does not test database durability,
 * distributed concurrency, key management, authentication, or player projections.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

type Choice = 'left' | 'right';
type State = { episode: string; revision: number; choices: Choice[]; secret: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

function makeCodec() {
  const key = randomBytes(32);
  const aad = (episode: string) => Buffer.from(JSON.stringify(['capsule-demo-v1', episode]));
  return {
    seal(state: State): string {
      // Demo only: production must define key lifetime and nonce collision limits.
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad(state.episode));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    },
    open(episode: string, capsule: string): State {
      const bytes = Buffer.from(capsule, 'base64url');
      if (bytes.length < 29) throw new Error('INVALID_CAPSULE');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(aad(episode));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
      const state: State = JSON.parse(plain.toString('utf8'));
      assert.equal(state.episode, episode);
      return state;
    },
  };
}

function advance(state: State, choice: Choice): State {
  assert.ok(choice === 'left' || choice === 'right');
  return { ...state, revision: state.revision + 1, choices: [...state.choices, choice] };
}

function fixture() {
  const codec = makeCodec();
  const episode = 'synthetic-episode';
  const initial = codec.seal({ episode, revision: 0, choices: [], secret: 'synthetic-hidden-card' });
  return { codec, episode, initial };
}

function authority(f: ReturnType<typeof fixture>) {
  // This is the extra state missing from the purely stateless proposal.
  let headHash = hash(f.initial);
  const receipts = new Map<string, { requestHash: string; response: string }>();
  return {
    submit(capsule: string, choice: Choice, requestId: string, actor = 'p1'): string {
      f.codec.open(f.episode, capsule);
      // Actor is assumed already authenticated by the host in this model.
      const receiptKey = JSON.stringify([f.episode, actor, requestId]);
      const requestHash = hash(JSON.stringify([capsule, choice]));
      const prior = receipts.get(receiptKey);
      if (prior) {
        if (prior.requestHash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT');
        return prior.response; // Retry must work even after the head has advanced.
      }
      if (hash(capsule) !== headHash) throw new Error('STALE_HEAD');
      const response = f.codec.seal(advance(f.codec.open(f.episode, capsule), choice));
      // Models ONE atomic commit; real implementations need a DB transaction / CAS.
      headHash = hash(response);
      receipts.set(receiptKey, { requestHash, response });
      return response;
    },
  };
}

test('AEAD rejects ciphertext modification', () => {
  const f = fixture();
  const tampered = Buffer.from(f.initial, 'base64url');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => f.codec.open(f.episode, tampered.toString('base64url')));
});

test('binding episode as authenticated data prevents cross-episode transplant', () => {
  const f = fixture();
  assert.throws(() => f.codec.open('different-episode', f.initial));
});

test('pure stateless processing accepts two valid children from the same old state', () => {
  const f = fixture();
  const left = f.codec.seal(advance(f.codec.open(f.episode, f.initial), 'left'));
  const right = f.codec.seal(advance(f.codec.open(f.episode, f.initial), 'right'));
  assert.equal(f.codec.open(f.episode, left).revision, 1);
  assert.equal(f.codec.open(f.episode, right).revision, 1);
  assert.notDeepEqual(f.codec.open(f.episode, left).choices, f.codec.open(f.episode, right).choices);
  // Neither encryption, an internal revision, nor a common parent selects the canonical child.
});

test('shared current-head check rejects the second branch', () => {
  const f = fixture();
  const service = authority(f);
  service.submit(f.initial, 'left', 'request-1');
  assert.throws(() => service.submit(f.initial, 'right', 'request-2'), /STALE_HEAD/);
});

test('lost-response retry returns the exact receipt without executing a second move', () => {
  const f = fixture();
  const service = authority(f);
  const committed = service.submit(f.initial, 'left', 'request-1');
  assert.equal(service.submit(f.initial, 'left', 'request-1'), committed);
  assert.equal(f.codec.open(f.episode, committed).revision, 1);
});

test('old successful receipt remains retryable after another accepted action', () => {
  const f = fixture();
  const service = authority(f);
  const first = service.submit(f.initial, 'left', 'request-1');
  const second = service.submit(first, 'right', 'request-2');
  assert.equal(service.submit(f.initial, 'left', 'request-1'), first);
  assert.equal(f.codec.open(f.episode, second).revision, 2);
});

test('same idempotency key with a different action is rejected', () => {
  const f = fixture();
  const service = authority(f);
  service.submit(f.initial, 'left', 'request-1');
  assert.throws(() => service.submit(f.initial, 'right', 'request-1'), /IDEMPOTENCY_CONFLICT/);
});

test('request keys are scoped to the authenticated actor', () => {
  const f = fixture();
  const service = authority(f);
  service.submit(f.initial, 'left', 'same-key', 'p1');
  assert.throws(() => service.submit(f.initial, 'left', 'same-key', 'p2'), /STALE_HEAD/);
});
