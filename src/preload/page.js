'use strict';
// Runs in every tab. Only Imp's own imp:// pages get the privileged bridge;
// ordinary websites see nothing.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'imp:') {
  contextBridge.exposeInMainWorld('imp', {
    call: (method, ...args) => ipcRenderer.invoke('imp:api', method, args),
    on: (fn) => ipcRenderer.on('imp:event', (event, type, data) => fn(type, data)),
  });
}
