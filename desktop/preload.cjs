const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, input) {
  const result = await ipcRenderer.invoke(channel, input);
  if (!result?.ok) {
    // Error custom properties are not preserved by contextBridge. Pass a plain
    // record for transport.js to turn into an Error in the renderer's context.
    return { __coopClientError: result?.error || { code: 'CLIENT_ERROR', message: '客户端操作失败。' } };
  }
  return result.value;
}
contextBridge.exposeInMainWorld('coopDesktop', Object.freeze({
  getConnection: () => invoke('coop:get-connection'),
  connect: input => invoke('coop:connect', input),
  login: input => invoke('coop:login', input),
  setPassword: input => invoke('coop:set-password', input),
  getAccount: () => invoke('coop:get-account'),
  disconnect: () => invoke('coop:disconnect'),
  request: input => invoke('coop:request', input),
  cancelRequest: id => invoke('coop:cancel-request', id),
  copyText: text => invoke('coop:copy-text', text),
}));
