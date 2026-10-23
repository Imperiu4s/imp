'use strict';
const { app, session, screen, powerMonitor, BrowserWindow } = require('electron');
const BrowserWin = require('./window');
const Tab = require('./tab');
const settings = require('./settings');
const shields = require('./shields');
const downloads = require('./downloads');
const permissions = require('./permissions');
const { readJson, writeJsonSync } = require('./store');

class WindowManager {
  constructor() {
    this.windows = new Set();
    this.lastFocused = null;
    this.closedTabs = [];
    this.quitting = false;
    this.privateCount = 0;
    this.updateState = null;
    this.browsing = null;
    this.saveTimer = null;
  }

  init(browsingSession) {
    this.browsing = browsingSession;
    setInterval(() => this.sleepCheck(), 60_000);
  }

  setupSession(ses, isPrivate) {
    require('./internal').registerProtocol(ses);
    shields.setupSession(ses);
    downloads.setupSession(ses, isPrivate);
    permissions.setupSession(ses, (wc) => this.findTab(wc), isPrivate);
    try {
      const available = ses.availableSpellCheckerLanguages || [];
      const wanted = [app.getLocale(), app.getLocale().split('-')[0], 'hu', 'en-US'].filter((l, i, a) => available.includes(l) && a.indexOf(l) === i);
      if (wanted.length && process.platform !== 'darwin') ses.setSpellCheckerLanguages(wanted.slice(0, 3));
    } catch {}
  }

  createPrivateSession() {
    const ses = session.fromPartition(`imp-private-${++this.privateCount}`, { cache: false });
    this.setupSession(ses, true);
    return ses;
  }

  startUrl(isPrivate) {
    if (!isPrivate && settings.get('startup.mode') === 'home') return settings.get('startup.homepage') || Tab.NEW_TAB;
    return Tab.NEW_TAB;
  }

  validBounds(b) {
    if (!b || !b.width || !b.height) return null;
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
    return visible ? b : null;
  }

  createWindow({ private: isPrivate = false, tabs, url, bounds, maximized, activeIndex } = {}) {
    const ses = isPrivate ? this.createPrivateSession() : this.browsing;
    const w = new BrowserWin(this, { private: isPrivate, session: ses, bounds: this.validBounds(bounds), maximized });
    this.windows.add(w);
    if (tabs && tabs.length) w.restoreTabs(tabs, activeIndex);
    else w.createTab({ url: url || this.startUrl(isPrivate) });
    this.lastFocused = w;
    return w;
  }

  focused() {
    const fw = BrowserWindow.getFocusedWindow();
    for (const w of this.windows) if (w.win === fw) return w;
    if (this.lastFocused && this.windows.has(this.lastFocused)) return this.lastFocused;
    return [...this.windows][0] || null;
  }

  fromWebContents(wc) {
    for (const w of this.windows) {
      if (w.webContents === wc) return w;
      if (w.overlay && w.overlay.webContents === wc) return w;
    }
    const tab = this.findTab(wc);
    return tab ? tab.win : null;
  }

  findTab(wc) {
    for (const w of this.windows) for (const tab of w.tabs) if (tab.view && tab.view.webContents === wc) return tab;
    return null;
  }

  findTabByWcId(id) {
    for (const w of this.windows) for (const tab of w.tabs) if (tab.view && tab.view.webContents.id === id) return tab;
    return null;
  }

  allTabs() {
    const out = [];
    for (const w of this.windows) for (const tab of w.tabs) out.push(tab);
    return out;
  }

  openUrl(url) {
    let w = this.focused();
    if (!w || w.isPrivate) w = [...this.windows].find((x) => !x.isPrivate) || null;
    if (!w) return this.createWindow({ url });
    w.createTab({ url });
    if (w.win.isMinimized()) w.win.restore();
    w.win.focus();
    return w;
  }

  broadcast(channel, data) {
    for (const w of this.windows) {
      w.send(channel, data);
      if (w.overlay && w.overlayReady && !w.overlay.webContents.isDestroyed()) w.overlay.webContents.send(channel, data);
    }
  }

  notifyPages(type = 'refresh', data = null) {
    for (const tab of this.allTabs()) {
      const wc = tab.wc;
      if (wc && wc.getURL().startsWith('imp://')) wc.send('imp:event', type, data);
    }
  }

  refreshTheme() {
    for (const w of this.windows) w.refreshTheme();
  }

  // ---- closed tabs ---------------------------------------------------------------------

  pushClosed(snap) {
    this.closedTabs.push(snap);
    if (this.closedTabs.length > 25) this.closedTabs.shift();
  }

  reopenClosed(win) {
    const snap = this.closedTabs.pop();
    if (!snap) return;
    win.createTab({ ...snap, index: snap.index });
  }

  // ---- session ---------------------------------------------------------------------------

  saveSoon() {
    if (this.quitting) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveSession(), 2000);
  }

  saveSession(extra) {
    clearTimeout(this.saveTimer);
    const wins = [...this.windows].filter((w) => !w.isPrivate && !w.closing && !w.win.isDestroyed());
    if (extra && !extra.win.isDestroyed()) wins.push(extra);
    if (!wins.length) return;
    const data = {
      windows: wins
        .filter((w) => w.tabs.length)
        .map((w) => ({
          bounds: w.win.getNormalBounds(),
          maximized: w.win.isMaximized(),
          active: Math.max(0, w.tabs.findIndex((tab) => tab.id === w.activeId)),
          tabs: w.tabs.map((tab) => tab.snapshot()),
        })),
    };
    try {
      writeJsonSync('session.json', data);
    } catch (err) {
      console.error('[session] save failed', err);
    }
  }

  restoreSession() {
    const data = readJson('session.json', null);
    if (!data?.windows?.length) return false;
    for (const wd of data.windows) {
      if (!wd.tabs?.length) continue;
      this.createWindow({ tabs: wd.tabs, bounds: wd.bounds, maximized: wd.maximized, activeIndex: wd.active });
    }
    return this.windows.size > 0;
  }

  onWindowClosing(w) {
    if (this.quitting || w.isPrivate) return;
    const others = [...this.windows].filter((x) => x !== w && !x.isPrivate && !x.closing);
    w.closing = true;
    this.saveSession(others.length ? undefined : w);
  }

  onWindowClosed(w) {
    this.windows.delete(w);
    if (this.lastFocused === w) this.lastFocused = null;
  }

  // ---- performance -----------------------------------------------------------------------

  efficiencyActive() {
    const mode = settings.get('performance.efficiency');
    return mode === 'on' || (mode === 'auto' && powerMonitor.isOnBatteryPower());
  }

  sleepCheck() {
    if (!settings.get('performance.sleepingTabs')) return;
    let minutes = settings.get('performance.sleepAfter');
    if (this.efficiencyActive()) minutes = Math.min(minutes, 5);
    const cutoff = Date.now() - minutes * 60_000;
    for (const w of this.windows) {
      for (const tab of w.tabs) {
        if (tab.sleeping || !tab.wc || w.isVisible(tab) || tab.lastActive > cutoff) continue;
        if (tab.audible || tab.permissionRequests.length) continue;
        if (tab.wc.isCurrentlyAudible() || tab.wc.isDevToolsOpened()) continue;
        tab.sleep();
      }
    }
  }

  installUpdate() {
    require('./updater').install();
  }
}

module.exports = new WindowManager();
