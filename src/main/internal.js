'use strict';
// imp:// internal pages: the protocol handler and the privileged API they use.
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog, shell, clipboard } = require('electron');
const settings = require('./settings');
const history = require('./history');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const permissions = require('./permissions');
const shields = require('./shields');
const shortcuts = require('./shortcuts');
const reader = require('./reader');
const passwords = require('./passwords');
const ENGINES = require('../shared/engines');

const PAGES_DIR = path.join(__dirname, '../pages');
const SHARED_DIR = path.join(__dirname, '../shared');
const ASSETS_DIR = path.join(__dirname, '../ui/assets');
const PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'performance', 'reader', 'welcome', 'passwords']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https:",
].join('; ');

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

function registerProtocol(ses) {
  if (ses.protocol.isProtocolHandled('imp')) return;
  ses.protocol.handle('imp', async (request) => {
    const url = new URL(request.url);
    const page = url.hostname;
    const rel = decodeURIComponent(url.pathname);
    let file = null;
    if (rel === '/' || rel === '') file = PAGES.has(page) ? path.join(PAGES_DIR, `${page}.html`) : path.join(PAGES_DIR, 'newtab.html');
    else if (rel.startsWith('/shared/')) file = safeJoin(SHARED_DIR, rel.slice(8));
    else if (rel.startsWith('/assets/')) file = safeJoin(ASSETS_DIR, rel.slice(8));
    else file = safeJoin(PAGES_DIR, rel.slice(1));
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(file)] || 'application/octet-stream',
          'content-security-policy': CSP,
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------------------

let manager = null;
let updater = null;

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

async function clearData({ range = 'all', history: h = true, cookies = false, cache = true, downloads: d = false } = {}) {
  const ses = manager.browsing;
  if (h) {
    history.clear(range);
    manager.closedTabs = [];
  }
  if (d) downloads.clear();
  if (cache) await ses.clearCache();
  if (cookies) {
    await ses.clearStorageData();
    await ses.clearAuthCache();
  }
  return true;
}

function perfMetrics() {
  const metrics = app.getAppMetrics();
  const tabs = [];
  for (const w of manager.windows) {
    for (const tab of w.tabs) {
      const wc = tab.wc;
      tabs.push({
        id: tab.id,
        windowId: w.id,
        title: tab.title || tab.displayUrl(),
        url: tab.displayUrl(),
        favicon: tab.favicon,
        sleeping: tab.sleeping,
        active: w.isVisible(tab),
        audible: tab.audible,
        private: w.isPrivate,
        pid: wc ? wc.getOSProcessId() : null,
      });
    }
  }
  const uiPids = new Set();
  for (const w of manager.windows) {
    if (!w.webContents.isDestroyed()) uiPids.add(w.webContents.getOSProcessId());
    if (w.overlay && !w.overlay.webContents.isDestroyed()) uiPids.add(w.overlay.webContents.getOSProcessId());
  }
  return {
    processes: metrics.map((m) => ({
      pid: m.pid,
      type: m.type,
      name: m.name || m.serviceName || '',
      cpu: m.cpu?.percentCPUUsage || 0,
      memory: m.memory?.workingSetSize || 0,
      privateMemory: m.memory?.privateBytes || 0,
      ui: uiPids.has(m.pid),
    })),
    tabs,
    efficiency: manager.efficiencyActive(),
  };
}

function newtabData(ctx) {
  const isPrivate = !!ctx?.win?.isPrivate;
  const hidden = new Set(settings.get('newtab.hiddenSites'));
  const custom = settings.get('newtab.shortcuts');
  const customUrls = new Set(custom.map((s) => s.url));
  const top = history
    .topSites(12)
    .filter((s) => !hidden.has(s.url) && !customUrls.has(s.url))
    .map((s) => ({ title: s.title, url: s.url, favicon: s.favicon }));
  return {
    private: isPrivate,
    shortcuts: custom,
    topSites: isPrivate ? [] : top,
    stats: shields.getStats(),
    engine: ENGINES[settings.get('search.engine')] || ENGINES.duckduckgo,
  };
}

const API = {
  'app.info': () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    isDefault: app.isDefaultProtocolClient('https'),
    packaged: app.isPackaged,
    update: manager.updateState,
  }),
  'app.setDefault': async () => {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    if (process.platform === 'win32') await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Imp');
    return app.isDefaultProtocolClient('https');
  },
  'app.relaunch': () => {
    app.relaunch();
    app.quit();
  },
  'app.checkUpdate': () => updater?.check(true),
  'app.installUpdate': () => manager.installUpdate(),
  'app.openExternal': (url) => isHttpUrl(url) && shell.openExternal(url),
  'app.openDataFolder': () => shell.openPath(app.getPath('userData')),

  'settings.get': () => settings.data,
  'settings.set': (key, value) => settings.set(String(key), value),
  'settings.reset': () => settings.reset(),
  'settings.engines': () => ENGINES,
  'shortcuts.list': () => shortcuts.describe(),

  'history.list': (opts) => history.list(opts || {}),
  'history.deleteVisit': (id) => history.deleteVisit(Number(id)),
  'history.deleteUrl': (url) => history.deleteUrl(String(url)),
  'history.clear': (range) => history.clear(String(range || 'all')),

  'bookmarks.list': () => bookmarks.list(),
  'bookmarks.add': (item) => bookmarks.add({ title: item.title, url: item.url, parent: item.parent || 'bar', type: item.type === 'folder' ? 'folder' : 'bookmark' }),
  'bookmarks.update': (id, patch) => bookmarks.update(Number(id), patch || {}),
  'bookmarks.remove': (id) => bookmarks.remove(Number(id)),
  'bookmarks.move': (id, parent, beforeId) => bookmarks.move(Number(id), parent, beforeId),
  'bookmarks.removeChildren': (parent) => bookmarks.removeChildren(parent),
  'bookmarks.moveChildren': (from, to) => bookmarks.moveChildren(from, to),
  'bookmarks.importSources': () => bookmarks.availableImports(),
  'bookmarks.importBrowser': (name) => bookmarks.importFromBrowser(String(name)),
  'bookmarks.importHtml': async (ctx) => {
    const res = await dialog.showOpenDialog(ctx.win?.win, { properties: ['openFile'], filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
    if (res.canceled || !res.filePaths[0]) return -1;
    return bookmarks.importHtml(res.filePaths[0]);
  },
  'bookmarks.exportHtml': async (ctx) => {
    const res = await dialog.showSaveDialog(ctx.win?.win, { defaultPath: path.join(app.getPath('documents'), 'imp-bookmarks.html') });
    if (res.canceled || !res.filePath) return false;
    bookmarks.exportHtml(res.filePath);
    return true;
  },

  'passwords.list': () => ({ logins: passwords.list(), never: passwords.never() }),
  'passwords.count': () => passwords.count(),
  'passwords.reveal': (id) => passwords.reveal(Number(id)),
  'passwords.copy': (id, field) => {
    const login = passwords.get(Number(id));
    if (!login) return false;
    const text = field === 'username' ? login.username : passwords.reveal(login.id);
    if (text == null) return false;
    clipboard.writeText(text);
    return true;
  },
  'passwords.add': (item) => passwords.save({ url: String(item?.url || ''), username: String(item?.username || ''), password: String(item?.password || '') }),
  'passwords.update': (id, patch) => passwords.update(Number(id), patch || {}),
  'passwords.remove': (id) => passwords.remove(Number(id)),
  'passwords.removeAll': () => passwords.removeAll(),
  'passwords.removeNever': (origin) => passwords.removeNever(String(origin)),
  'passwords.importCsv': async (ctx) => {
    const res = await dialog.showOpenDialog(ctx.win?.win, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    try {
      return passwords.importCsv(await fs.promises.readFile(res.filePaths[0], 'utf8'));
    } catch {
      return { error: true };
    }
  },
  'passwords.exportCsv': async (ctx) => {
    const res = await dialog.showSaveDialog(ctx.win?.win, {
      defaultPath: path.join(app.getPath('documents'), 'imp-passwords.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.promises.writeFile(res.filePath, passwords.exportCsv(), 'utf8');
    return true;
  },

  'downloads.list': () => downloads.list(),
  'downloads.open': (id) => downloads.open(id),
  'downloads.show': (id) => downloads.show(id),
  'downloads.cancel': (id) => downloads.cancel(id),
  'downloads.pause': (id) => downloads.pause(id),
  'downloads.remove': (id) => downloads.remove(id),
  'downloads.clear': () => downloads.clear(),
  'downloads.dir': () => downloads.dir(),
  'downloads.openFolder': () => shell.openPath(downloads.dir()),
  'downloads.chooseDir': async (ctx) => {
    const res = await dialog.showOpenDialog(ctx.win?.win, { properties: ['openDirectory', 'createDirectory'], defaultPath: downloads.dir() });
    if (res.canceled || !res.filePaths[0]) return null;
    settings.set('downloads.dir', res.filePaths[0]);
    return res.filePaths[0];
  },

  'shields.stats': () => shields.getStats(),
  'shields.resetStats': () => shields.resetStats(),

  'newtab.data': (ctx) => newtabData(ctx),
  'newtab.hideSite': (url) => settings.set('newtab.hiddenSites', [...settings.get('newtab.hiddenSites'), String(url)].slice(-200)),
  'newtab.addShortcut': (s) => {
    if (!isHttpUrl(s?.url)) return false;
    const list = settings.get('newtab.shortcuts').filter((x) => x.url !== s.url);
    list.push({ title: String(s.title || '').slice(0, 80), url: s.url });
    settings.set('newtab.shortcuts', list.slice(0, 24));
    return true;
  },
  'newtab.removeShortcut': (url) => settings.set('newtab.shortcuts', settings.get('newtab.shortcuts').filter((x) => x.url !== url)),
  'newtab.chooseBackground': async (ctx) => {
    const res = await dialog.showOpenDialog(ctx.win?.win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const ext = path.extname(res.filePaths[0]).toLowerCase();
    const target = path.join(app.getPath('userData'), `newtab-bg${ext}`);
    fs.copyFileSync(res.filePaths[0], target);
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
    const buf = fs.readFileSync(target);
    if (buf.length > 8 * 1024 * 1024) return 'too-big';
    fs.writeFileSync(path.join(app.getPath('userData'), 'newtab-bg.json'), JSON.stringify({ mime, file: target }));
    settings.set('newtab.background', 'custom');
    return true;
  },
  'newtab.customBackground': () => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'newtab-bg.json'), 'utf8'));
      return `data:${meta.mime};base64,${fs.readFileSync(meta.file).toString('base64')}`;
    } catch {
      return null;
    }
  },

  'permissions.list': () => permissions.list(),
  'permissions.set': (origin, kind, value) => permissions.set(String(origin), String(kind), value || null),
  'permissions.clearSite': (origin) => permissions.clearSite(String(origin)),

  'data.clear': (opts) => clearData(opts || {}),

  'perf.metrics': () => perfMetrics(),
  'perf.sleepTab': (id) => {
    for (const w of manager.windows) {
      const tab = w.getTab(Number(id));
      if (tab && !w.isVisible(tab)) return tab.sleep();
    }
    return false;
  },
  'perf.sleepAll': () => {
    let n = 0;
    for (const w of manager.windows) for (const tab of w.tabs) if (!w.isVisible(tab) && tab.sleep()) n++;
    return n;
  },
  'perf.closeTab': (id) => {
    for (const w of manager.windows) if (w.getTab(Number(id))) return w.closeTab(Number(id));
  },
  'perf.activateTab': (id) => {
    for (const w of manager.windows) {
      if (w.getTab(Number(id))) {
        w.activate(Number(id));
        w.win.focus();
      }
    }
  },

  'reader.get': (id) => reader.get(String(id)),
  'welcome.done': () => settings.set('meta.firstRunDone', true),
};

// Reader pages render text taken from websites, so they only get read access.
const READER_METHODS = new Set(['reader.get', 'settings.get']);

function init(windowManager, updaterModule) {
  manager = windowManager;
  updater = updaterModule;
  ipcMain.handle('imp:api', async (event, method, args = []) => {
    const frame = event.senderFrame;
    const url = frame?.url || '';
    if (!url.startsWith('imp://') || frame !== event.sender.mainFrame) throw new Error('Forbidden');
    const page = new URL(url).hostname;
    if (page === 'reader' && !READER_METHODS.has(method)) throw new Error('Forbidden');
    const fn = API[method];
    if (!fn) throw new Error(`Unknown method: ${method}`);
    const tab = manager.findTab(event.sender);
    const ctx = { win: tab?.win || manager.focused(), tab };
    const params = Array.isArray(args) ? args : [];
    return fn(...params, ctx);
  });
}

module.exports = { registerProtocol, init, clearData };
