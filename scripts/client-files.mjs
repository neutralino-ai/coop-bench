// Explicit source/package boundary for the public remote client.
export const desktopFiles = ['main.mjs','preload.cjs','remote-session.mjs','update-client.mjs',
  'player-main.mjs','player-preload.cjs','lobby-player.mjs','client-smoke.mjs','player-smoke.mjs','mock-api.mjs'];
export const webFiles = ['app.js','index.html','play.css','play.html','play.js','player.css','player.html',
  'player.js','lobby.js','replay-model.js','replay-ui.js','replay.css','style.css','transport.js'];
export const packageFiles = ['package.json',...desktopFiles.map(name=>'desktop/'+name),
  'runtime/coop-bench/client/player.mjs','runtime/coop-bench/build-manifest.json',
  ...webFiles.map(name=>'runtime/coop-bench/web/'+name)];
