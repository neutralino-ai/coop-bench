import test from 'node:test';
import assert from 'node:assert/strict';
import { theGame } from '../src/games/the-game.ts';
const setup = (n = 3) => theGame.setup({ playerCount: n, seed: 'game-tests', scenarioId: 'base' });
test('The Game correct deck and hands per player count, hidden opponents', () => {
  for (const n of [1,2,3,4,5]) { const s = setup(n); assert.equal(s.hands.p1.length, n === 1 ? 8 : n === 2 ? 7 : 6); assert.equal(new Set([...s.deck,...Object.values(s.hands).flat()]).size, 98); const v = theGame.observe(s,'p1'); assert.ok(!('hands' in v) && !('deck' in v)); }
});
test('The Game chooses starter after deal; minimum two then one after deck exhaustion', () => {
  let s = setup(); s.hands.p2 = [20,30,40]; s.deck = [50]; s = theGame.step(s,'p3',{type:'choose_start',player:'p2'});
  s = theGame.step(s,'p2',{type:'play',card:20,pile:0}); assert.throws(() => theGame.step(s,'p2',{type:'end_turn'}));
  s = theGame.step(s,'p2',{type:'play',card:30,pile:0}); assert.equal(s.deck.length,1);
  s = theGame.step(s,'p2',{type:'end_turn'}); assert.equal(s.current,'p3'); assert.equal(s.deck.length,0); assert.equal(theGame.observe(s,'p3').minimum,1);
});
test('The Game reverse-ten allowed on both directions and other reversals rejected without mutation', () => {
  let s = setup(); s.current='p1'; s.hands.p1=[37,75,46]; s.piles=[47,1,65,100]; const copy=structuredClone(s);
  assert.throws(() => theGame.step(s,'p1',{type:'play',card:46,pile:0})); assert.deepEqual(s,copy);
  s=theGame.step(s,'p1',{type:'play',card:37,pile:0}); s=theGame.step(s,'p1',{type:'play',card:75,pile:2}); assert.deepEqual(s.piles,[37,1,75,100]);
});
test('The Game detects inability to make minimum including when only one first move is possible', () => {
  let s=setup(); s.hands.p1=[50,51]; s.piles=[49,99,2,2]; s=theGame.step(s,'p1',{type:'choose_start',player:'p1'}); assert.equal(s.done,false);
  s=theGame.step(s,'p1',{type:'play',card:51,pile:0}); assert.equal(s.done,true); assert.equal(theGame.outcome(s)?.reason,'cannot-play-minimum');
});
test('The Game skips empty hands and wins on the last placement', () => {
  let s=setup(); s.current='p1'; s.deck=[]; s.hands={p1:[3],p2:[],p3:[4]}; s.played=96;
  s=theGame.step(s,'p1',{type:'play',card:3,pile:0}); s=theGame.step(s,'p1',{type:'end_turn'}); assert.equal(s.current,'p3');
  s=theGame.step(s,'p3',{type:'play',card:4,pile:0}); assert.equal(theGame.outcome(s)?.success,true); assert.equal(theGame.outcome(s)?.score,98);
});
