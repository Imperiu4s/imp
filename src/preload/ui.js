'use strict';
// Bridge for the browser chrome (toolbar, tabs) and the popup overlay.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = /^(ui|tab|nav|omnibox|popup|overlay|bubble|find|perm|bookmark|split|palette):/;

contextBridge.exposeInMainWorld('imp', {
  send(channel, ...args) {
    if (ALLOWED.test(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (!ALLOWED.test(channel)) return Promise.reject(new Error('Blocked channel'));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, fn) {
    const listener = (event, data) => fn(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
