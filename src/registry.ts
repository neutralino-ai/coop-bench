import { skyTeam } from './games/sky-team.ts';
import { crewDeepSea, crewPlanetNine } from './games/crew.ts';
import { takeTime } from './games/take-time.ts';
import { hanabi } from './games/hanabi.ts';
import { theGang } from './games/the-gang.ts';
import { theMind } from './games/the-mind.ts';
import { theGame } from './games/the-game.ts';
import { bombBusters } from './games/bomb-busters.ts';
import { magicMaze } from './games/magic-maze.ts';
import type { GameAdapter } from './types.ts';

/** Only real implementations; excluded catalogue entries are never placeholders. */
export const games: GameAdapter[] = [skyTeam,crewDeepSea,bombBusters,crewPlanetNine,theGang,takeTime,hanabi,magicMaze,theMind,theGame];
export function getGame(id:string):GameAdapter {
  const game=games.find(g=>g.metadata.id===id);
  if(!game) throw new Error(`No implemented adapter: ${id}`);
  return game;
}
