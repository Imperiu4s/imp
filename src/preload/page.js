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

// Faster link clicks: when the pointer rests on a link to another site (or
// presses it), open the connection to that site already, so the page starts
// loading 100–300 ms sooner. The main process skips this when "Preconnect to
// pages" is turned off.
if (/^https?:$/.test(location.protocol)) {
  const done = new Map();
  let hoverTimer = 0;
  const warm = (target) => {
    const a = target instanceof Element ? target.closest('a[href]') : null;
    if (!a || !/^https?:$/.test(a.protocol) || a.origin === location.origin) return;
    const now = Date.now();
    if (now - (done.get(a.origin) || 0) < 10_000) return;
    done.set(a.origin, now);
    ipcRenderer.send('imp:preconnect', a.origin);
  };
  addEventListener('pointerover', (e) => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => warm(e.target), 80);
  }, { passive: true, capture: true });
  addEventListener('pointerdown', (e) => warm(e.target), { passive: true, capture: true });
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
