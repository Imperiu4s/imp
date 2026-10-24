'use strict';
// IPC between the browser UI / popup overlay and the main process.
const { ipcMain } = require('electron');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const permissions = require('./permissions');
const shields = require('./shields');
const history = require('./history');
const omnibox = require('./omnibox');
const menus = require('./menus');
const autofill = require('./autofill');
const predictor = require('./predictor');
const Tab = require('./tab');
const { t } = require('./i18n');

let manager;
let netSession;

function winOf(event) {
  return manager.fromWebContents(event.sender);
}

function on(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    const w = winOf(event);
    if (w) fn(w, ...args);
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const w = winOf(event);
    return w ? fn(w, ...args) : null;
  });
}

function originOf(url) {
  try {
    const o = new URL(url).origin;
    return o === 'null' ? '' : o;
  } catch {
    return '';
  }
}

function popupData(w, type, extra = {}) {
  const tab = w.activeTab();
  const url = tab ? tab.displayUrl() : '';
  switch (type) {
    case 'shields': {
      const host = shields.hostOf(url);
      const web = /^https?:/.test(url);
      return {
        host: host.replace(/^www\./, ''),
        web,
        on: web && !shields.isAllowlisted(host),
        blocked: tab ? tab.blocked : 0,
        hosts: tab ? [...tab.blockedHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) : [],
        https: url.startsWith('https://'),
        mode: settings.get('shields.adblock'),
        httpsMode: settings.get('shields.https'),
        stats: shields.getStats(),
      };
    }
    case 'downloads':
      return { items: downloads.list().slice(0, 8) };
    case 'menu':
      return {
        zoom: tab ? tab.zoom : 1,
        update: manager.updateState,
        isPrivate: w.isPrivate,
        fullscreen: w.win.isFullScreen(),
        readerable: !!tab?.readerable,
        web: /^https?:/.test(url),
      };
    case 'bookmark': {
      const item = bookmarks.findByUrl(url);
      return {
        item,
        folders: bookmarks.list().filter((b) => b.type === 'folder').map((f) => ({ id: f.id, title: f.title })),
        created: !!extra.created,
      };
    }
    case 'pwsave': {
      const offer = autofill.offerData(tab);
      return offer && { ...offer, auto: !!extra.auto };
    }
    case 'bmfolder':
      return {
        folder: extra.folder,
        title: extra.title || '',
        more: !!extra.more,
        hidden: Array.isArray(extra.hidden) ? extra.hidden.map(Number) : [],
      };
    case 'siteinfo': {
      const origin = originOf(url);
      return {
        url,
        origin,
        host: shields.hostOf(url),
        secure: url.startsWith('https://'),
        internal: url.startsWith('imp:'),
        file: url.startsWith('file:'),
        perms: origin ? permissions.sites[origin] || {} : {},
        shieldsOn: !shields.isAllowlisted(shields.hostOf(url)),
        blocked: tab ? tab.blocked : 0,
      };
    }
    default:
      return extra;
  }
}

function paletteQuery(w, text) {
  const q = String(text || '').trim().toLowerCase();
  const tabs = [];
  for (const win of manager.windows) {
    if (win.isPrivate !== w.isPrivate && win.isPrivate) continue;
    for (const tab of win.tabs) {
      const title = tab.title || tab.displayUrl();
      if (!q || title.toLowerCase().includes(q) || tab.displayUrl().toLowerCase().includes(q)) {
        tabs.push({ kind: 'tab', id: tab.id, windowId: win.id, title, url: tab.displayUrl(), favicon: tab.favicon, active: win.isVisible(tab) });
      }
    }
  }
  const out = { tabs: tabs.slice(0, 8), bookmarks: [], history: [] };
  if (q) {
    out.bookmarks = bookmarks
      .list()
      .filter((b) => b.type === 'bookmark' && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)))
      .slice(0, 5)
      .map((b) => ({ kind: 'url', title: b.title, url: b.url }));
    if (!w.isPrivate) {
      out.history = history
        .search(q, 6)
        .filter((h) => !out.bookmarks.some((b) => b.url === h.url))
        .map((h) => ({ kind: 'url', title: h.title || h.url, url: h.url, favicon: h.favicon }));
    }
  }
  return out;
}

function overlayAction(w, action, p = {}) {
  const tab = w.activeTab();
  switch (action) {
    case 'close':
      return w.closePopup();
    case 'auth-submit':
      w.finishAuth(p.user ?? '', p.pass ?? '');
      return w.closePopup();
    case 'pw-fill':
      return autofill.fill(w, Number(p.index));
    case 'pw-save':
      autofill.save(tab, { username: p.username, password: p.password });
      w.closePopup();
      return w.toast(t('pw.saved'));
    case 'pw-never':
      autofill.never(tab);
      return w.closePopup();
    case 'pw-manage':
      w.closePopup();
      return w.command('open-passwords');
    case 'suggest-pick':
      return w.send('omnibox:pick', p);
    case 'suggest-remove':
      w.webContents.focus();
      return w.send('omnibox:remove', p);
    case 'command':
      w.closePopup();
      return w.command(p.name, p.arg);
    case 'shields-toggle': {
      if (!tab) return;
      const host = shields.hostOf(tab.displayUrl());
      if (!host) return;
      shields.setSiteEnabled(host, !!p.on);
      tab.reload();
      return w.updatePopup('shields', popupData(w, 'shields'));
    }
    case 'zoom':
      w.stepZoom(tab, p.dir);
      return w.updatePopup('menu', popupData(w, 'menu'));
    case 'download':
      if (p.op === 'open') downloads.open(p.id);
      else if (p.op === 'show') downloads.show(p.id);
      else if (p.op === 'cancel') downloads.cancel(p.id);
      else if (p.op === 'pause') downloads.pause(p.id);
      else if (p.op === 'remove') downloads.remove(p.id);
      if (p.op === 'open' || p.op === 'show') w.closePopup();
      return;
    case 'bookmark-save':
      bookmarks.update(Number(p.id), { title: p.title, parent: p.parent });
      return w.closePopup();
    case 'bookmark-remove':
      bookmarks.remove(Number(p.id));
      return w.closePopup();
    case 'perm-set':
      permissions.set(p.origin, p.kind, p.value || null);
      return w.updatePopup('siteinfo', popupData(w, 'siteinfo'));
    case 'site-clear':
      if (p.origin) {
        w.session
          .clearStorageData({ origin: p.origin })
          .then(() => {
            w.closePopup();
            w.toast(t('toast.siteCleared'));
            tab?.reload();
          })
          .catch(() => {});
      }
      return;
    case 'open-url': {
      w.closePopup();
      if (!p.url) return;
      if (p.disposition === 'new-tab') return w.createTab({ url: p.url });
      if (p.disposition === 'background-tab') return w.createTab({ url: p.url, active: false });
      return tab ? tab.load(p.url) : w.createTab({ url: p.url });
    }
    case 'bookmark-open': {
      w.closePopup();
      const item = bookmarks.find(Number(p.id));
      if (!item || item.type !== 'bookmark') return;
      if (p.disposition === 'new-tab') return w.createTab({ url: item.url, active: !p.background });
      return tab ? tab.load(item.url) : w.createTab({ url: item.url });
    }
    case 'focus-tab': {
      w.closePopup();
      for (const win of manager.windows) {
        if (win.id === p.windowId && win.getTab(p.id)) {
          win.activate(p.id);
          if (win !== w) win.win.focus();
        }
      }
      return;
    }
    default:
      return undefined;
  }
}

function init(windowManager, net) {
  manager = windowManager;
  netSession = net;

  // From the tab preload: the pointer is on a link to another site.
  ipcMain.on('imp:preconnect', (event, origin) => {
    if (!settings.get('performance.preconnect') || typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) return;
    try {
      event.sender.session.preconnect({ url: origin, numSockets: 1 });
    } catch {}
  });

  on('ui:ready', (w) => w.onUiReady());
  on('overlay:ready', (w) => w.onOverlayReady());
  on('ui:bounds', (w, b) => {
    if (b && Number.isFinite(b.width)) w.setPageBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) });
  });
  on('ui:command', (w, name, arg) => w.command(name, arg));
  on('ui:setting', (w, key, value) => {
    const allowed = ['appearance.sidebarCollapsed', 'appearance.verticalTabs', 'appearance.bookmarksBar', 'appearance.theme'];
    if (allowed.includes(key)) settings.set(key, value);
  });

  on('tab:activate', (w, id) => w.activate(id));
  on('tab:close', (w, id) => w.closeTab(id));
  on('tab:move', (w, id, index) => w.moveTab(id, index));
  on('tab:menu', (w, id) => menus.tab(w, w.getTab(id)));
  on('tab:mute', (w, id) => {
    const tab = w.getTab(id);
    if (tab) tab.setMuted(!tab.muted);
  });
  on('tab:new', (w, opts) => w.createTab({ url: opts?.url, index: opts?.index }));

  on('nav:go', (w, text, opts) => w.navigate(text, opts || {}));
  on('nav:url', (w, url, opts = {}) => {
    if (typeof url !== 'string' || /^javascript:/i.test(url)) return;
    if (opts.disposition === 'new-tab') w.createTab({ url, active: !opts.background });
    else {
      const tab = w.activeTab();
      if (tab) {
        tab.typed = !!opts.typed;
        tab.load(url);
        tab.omniboxFocusUntil = 0;
        tab.wc?.focus();
      } else w.createTab({ url });
    }
  });

  handle('omnibox:suggest', (w, text) => omnibox.suggest(String(text || ''), { isPrivate: w.isPrivate }));
  handle('omnibox:remote', (w, text) => omnibox.remoteSuggestions(String(text || ''), netSession));
  handle('omnibox:recent', (w) => (w.isPrivate ? [] : history.recentSearches(8)));
  // Pre-open connections to the search engine (results page and suggestions)
  // as soon as the address bar is focused, saving a DNS + TLS round trip.
  on('omnibox:warmup', (w) => {
    if (!settings.get('performance.preconnect')) return;
    const e = omnibox.engine();
    try {
      w.session.preconnect({ url: new URL(e.search).origin, numSockets: 1 });
      if (e.suggest && settings.get('search.suggestions')) netSession.preconnect({ url: new URL(e.suggest).origin, numSockets: 1 });
    } catch {}
  });
  handle('omnibox:forget', (w, query) => history.deleteSearch(String(query || '')));
  on('omnibox:preconnect', (w, url) => {
    if (!settings.get('performance.preconnect') || !/^https?:\/\//.test(url)) return;
    try {
      w.session.preconnect({ url, numSockets: 1 });
    } catch {}
    predictor.prefetchDns(w.session, url, 3);
  });

  on('popup:open', (w, type, anchor, extra) => {
    let data = extra || {};
    if (type === 'bookmark') {
      const tab = w.activeTab();
      if (!tab || w.isPrivate) return;
      const url = tab.displayUrl();
      if (!/^(https?|file):/.test(url)) return;
      let created = false;
      if (!bookmarks.findByUrl(url)) {
        bookmarks.add({ title: tab.title || url, url, parent: 'bar', favicon: tab.favicon });
        created = true;
      }
      data = popupData(w, 'bookmark', { created });
    } else if (type !== 'suggest' && type !== 'palette') {
      data = popupData(w, type, extra || {});
      if (type === 'pwsave' && !data) return;
    }
    w.openPopup(type, anchor, data);
  });
  on('popup:update', (w, type, data) => w.updatePopup(type, data));
  on('popup:close', (w, type) => w.closePopup(type || null));
  on('overlay:size', (w, info) => w.onOverlaySize(info || {}));
  on('overlay:action', (w, action, payload) => overlayAction(w, action, payload));
  on('bubble:action', (w) => w.onBubbleAction());
  handle('palette:query', (w, text) => paletteQuery(w, text));

  on('find:query', (w, text, opts) => w.find(String(text || ''), opts || {}));
  on('find:stop', (w) => w.stopFind());
  on('perm:respond', (w, tabId, allow) => w.respondPermission(tabId, allow));
  on('bookmark:menu', (w, id) => menus.bookmark(w, id));
  on('download:menu', (w, id) => menus.download(w, String(id)));
  on('download:op', (w, op, id) => {
    if (op === 'open') downloads.open(String(id));
  });
  // Drag and drop on the bookmarks bar and in its folder lists.
  const validParent = (p) => p === 'bar' || p === 'other' || bookmarks.find(Number(p))?.type === 'folder';
  const parentOf = (p) => (p === 'bar' || p === 'other' ? p : Number(p));
  on('bookmark:move', (w, id, parent, beforeId) => {
    if (!bookmarks.find(Number(id)) || !validParent(parent)) return;
    bookmarks.move(Number(id), parentOf(parent), beforeId == null ? null : Number(beforeId));
  });
  on('bookmark:add', (w, item) => {
    if (w.isPrivate || !item || !/^https?:\/\//i.test(item.url || '') || !validParent(item.parent)) return;
    const added = bookmarks.add({ title: String(item.title || item.url).slice(0, 500), url: String(item.url), parent: parentOf(item.parent) });
    if (item.before != null) bookmarks.move(added.id, parentOf(item.parent), Number(item.before));
  });
  on('split:ratio', (w, ratio) => w.setSplitRatio(ratio));

  // keep UIs in sync
  bookmarks.on('change', () => {
    manager.broadcast('state:bookmarks', bookmarks.list());
    for (const w of manager.windows) w.sendTabs();
    manager.notifyPages('bookmarks');
  });
  downloads.on('change', () => {
    const progress = downloads.progress();
    manager.broadcast('state:downloads', { ...progress, hasDownloads: true, items: downloads.list().slice(0, 15) });
    for (const w of manager.windows) {
      if (!w.win.isDestroyed()) w.win.setProgressBar(progress.count ? (progress.fraction < 0 ? 2 : progress.fraction) : -1);
      if (w.popup?.type === 'downloads') w.updatePopup('downloads', popupData(w, 'downloads'));
    }
    manager.notifyPages('downloads');
  });
  downloads.on('started', (info) => {
    const w = manager.focused();
    if (w) w.send('ui:download-started', { id: info.id });
  });
}

module.exports = { init, popupData, NEW_TAB: Tab.NEW_TAB };
