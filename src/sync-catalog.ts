import { readFileSync, writeFileSync } from 'node:fs';
import { games } from './registry.ts';

const file=new URL('../catalog/ranked-games.json',import.meta.url);
const catalogue=JSON.parse(readFileSync(file,'utf8'));
const aliases:Record<string,string>={'the-crew-mission-deep-sea':'crew-deep-sea','the-crew-quest-for-planet-nine':'crew-planet-nine'};
const missing:Record<string,string>={
  'just-one':'Rules verified. Complete official word-card data or an independently playable official demo set was not acquired; no invented substitute deck.',
  'so-clover':'Rules verified. Complete four-edge word-card grouping/orientation data or a complete multiplayer official demo set was not acquired.',
  'codenames-duet':'Rules verified. Edition-matched official word cards and paired key data sufficient for a verified complete setup were not acquired; generated keys are not silently substituted.'
};
for(const entry of catalogue.games){
  const adapter=games.find(game=>game.metadata.id===(aliases[entry.id]??entry.id));
  if(adapter){
    const m=adapter.metadata;entry.runtimeGameId=m.id;entry.canCreateEpisode=true;
    entry.implementationStatus=m.implementation.fidelity==='official-core'?'implemented-official-core':'implemented-bounded-official-scope';
    entry.implementedPlayerCounts=m.players;entry.implementedScenarios=m.scenarios;entry.ruleSources=m.sources;
    entry.implementation=m.implementation;entry.sourceAudit=`Verified for these scopes only: ${m.scenarios.map(s=>s.name).join('; ')}. See implementation-admission.md and per-game implementation notes.`;
    delete entry.exclusionReason;
  }else{
    if(!missing[entry.id])throw new Error(`Unclassified candidate: ${entry.id}`);
    entry.canCreateEpisode=false;entry.implementationStatus='excluded-missing-components';entry.exclusionReason=missing[entry.id];entry.sourceAudit=missing[entry.id];
  }
}
catalogue.schemaVersion='0.3';catalogue.implementationVerifiedAt='2026-09-16';
catalogue.selection.candidateCount=catalogue.games.length;catalogue.selection.activeCount=games.length;
catalogue.selection.implementedGameCount=games.length;catalogue.selection.excludedForMissingComponents=Object.keys(missing).length;
catalogue.boundedOfficialTaskCandidate.status='implemented';catalogue.boundedOfficialTaskCandidate.runtimeGameId='crew-deep-sea';
writeFileSync(file,JSON.stringify(catalogue,null,2)+'\n');
console.log(`Catalogue synchronized: ${games.length} runnable games; ${Object.keys(missing).length} excluded.`);
