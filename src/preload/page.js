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

// Google sign-in compatibility (see src/main/compat.js): make the page's view
// of the browser match the Firefox identity sent in the request headers.
if (/^accounts\.(google\.[a-z.]+|youtube\.com)$/i.test(location.hostname)) {
  const ua = ipcRenderer.sendSync('imp:compat-ua');
  contextBridge.executeInMainWorld({
    func: (userAgent) => {
      const define = (obj, prop, value) => {
        try {
          Object.defineProperty(obj, prop, { get: () => value, configurable: true });
        } catch {}
      };
      const nav = Navigator.prototype;
      define(nav, 'userAgent', userAgent);
      define(nav, 'appVersion', userAgent.slice('Mozilla/'.length));
      define(nav, 'vendor', '');
      define(nav, 'productSub', '20100101');
      define(nav, 'oscpu', (userAgent.match(/\(([^)]*?); rv:/) || [])[1] || '');
      define(nav, 'userAgentData', undefined);
      try {
        delete window.chrome;
      } catch {}
    },
    args: [ua],
  });
}
