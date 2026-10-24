'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, nativeTheme, screen, clipboard, dialog, shell, nativeImage } = require('electron');
const Tab = require('./tab');
const settings = require('./settings');
const bookmarks = require('./bookmarks');
const downloads = require('./downloads');
const shields = require('./shields');
const shortcuts = require('./shortcuts');
const menus = require('./menus');
const reader = require('./reader');
const { t, lang } = require('./i18n');
const trace = require('./trace');
const autofill = require('./autofill');

const UI_PRELOAD = path.join(__dirname, '../preload/ui.js');
const UI_HTML = path.join(__dirname, '../ui/index.html');
const OVERLAY_HTML = path.join(__dirname, '../ui/overlay.html');
const ICON = path.join(__dirname, '../ui/assets/icon.png');
// Computers with less memory don't keep a new tab page loaded in advance.
const SPARE_TAB_MIN_MEMORY = 3.5 * 1024 ** 3;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const PALETTES = {
  light: { frame: '#E7EAF1', toolbar: '#FFFFFF', symbol: '#1E2230', page: '#F5F6FA' },
  dark: { frame: '#14161C', toolbar: '#1F222A', symbol: '#E6E8EE', page: '#16181E' },
  private: { frame: '#181229', toolbar: '#231A3D', symbol: '#ECE6FF', page: '#15111F' },
};

let popupSeq = 0;

class BrowserWin {
  constructor(manager, opts = {}) {
    this.manager = manager;
    this.isPrivate = !!opts.private;
    this.session = opts.session;
    this.tabs = [];
    this.activeId = null;
    this.split = null; // { left, right }
    this.splitRatio = 0.5;
    this.pageBounds = null;
    this.attached = new Set();
    this.fullscreenTab = null;
    this.overlay = null;
    this.overlayReady = false;
    this.overlayQueue = [];
    this.overlayAttached = false;
    this.popup = null;
    this.bubble = null;
    this.uiReady = false;
    this.sendTimer = null;

    const p = this.palette();
    const b = opts.bounds || BrowserWin.defaultBounds();
    this.win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      minWidth: 520,
      minHeight: 360,
      show: false,
      title: 'Imp',
      icon: ICON,
      backgroundColor: p.frame,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : { titleBarOverlay: this.titleBarOverlay() }),
      webPreferences: {
        preload: UI_PRELOAD,
        partition: 'persist:imp-ui',
        sandbox: true,
        contextIsolation: true,
        spellcheck: false,
      },
    });
    this.webContents = this.win.webContents;
    this.id = this.win.id;
    this.wireWindow(opts);
    this.webContents.loadFile(UI_HTML, { query: { private: this.isPrivate ? '1' : '0', platform: process.platform } });
  }

  static defaultBounds() {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1360, Math.round(area.width * 0.86));
    const height = Math.min(900, Math.round(area.height * 0.88));
    return {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    };
  }

  palette() {
    if (this.isPrivate) return PALETTES.private;
    return nativeTheme.shouldUseDarkColors ? PALETTES.dark : PALETTES.light;
  }

  pageBackground() {
    return this.palette().page;
  }

  titleBarOverlay() {
    const p = this.palette();
    const vertical = settings.get('appearance.verticalTabs');
    return { color: vertical ? p.toolbar : p.frame, symbolColor: p.symbol, height: vertical ? 44 : 40 };
  }

  refreshTheme() {
    if (this.win.isDestroyed()) return;
    const p = this.palette();
    this.win.setBackgroundColor(p.frame);
    if (process.platform !== 'darwin') this.win.setTitleBarOverlay(this.titleBarOverlay());
    for (const tab of this.spareTab ? [...this.tabs, this.spareTab] : this.tabs) {
      if (tab.view && tab.url.startsWith('imp:')) tab.view.setBackgroundColor(p.page);
    }
  }

  wireWindow(opts) {
    const win = this.win;
    const wc = this.webContents;
    // Show the window as soon as the browser UI has its state (a frame later),
    // instead of waiting for Chromium's 'ready-to-show', which fires ~200 ms later.
    this.reveal = () => {
      if (this.revealed || win.isDestroyed()) return;
      this.revealed = true;
      trace.mark('window shown');
      if (opts.maximized) win.maximize();
      if (opts.inactive) win.showInactive();
      else win.show();
    };
    win.once('ready-to-show', this.reveal);
    win.on('focus', () => {
      this.manager.lastFocused = this;
      this.send('win:focus', true);
    });
    win.on('blur', () => {
      this.send('win:focus', false);
      this.closePopup(null, true);
    });
    win.on('resize', () => {
      this.closePopup(null, true);
      if (this.fullscreenTab) this.layout();
    });
    win.on('move', () => this.closePopup(null, true));
    win.on('enter-full-screen', () => this.send('win:fullscreen', true));
    win.on('leave-full-screen', () => {
      this.send('win:fullscreen', false);
      if (this.fullscreenTab) {
        this.fullscreenTab.wc?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
        this.fullscreenTab = null;
        this.send('ui:html-fullscreen', false);
        this.layout();
      }
    });
    win.on('maximize', () => this.send('win:maximized', true));
    win.on('unmaximize', () => this.send('win:maximized', false));
    win.on('app-command', (e, cmd) => {
      if (cmd === 'browser-backward') this.activeTab()?.goBack();
      else if (cmd === 'browser-forward') this.activeTab()?.goForward();
    });
    win.on('close', () => this.manager.onWindowClosing(this));
    win.on('closed', () => {
      clearTimeout(this.spareTimer);
      this.spareTab?.destroy();
      this.spareTab = null;
      for (const tab of this.tabs) tab.destroy();
      this.tabs = [];
      if (this.overlay && !this.overlay.webContents.isDestroyed()) this.overlay.webContents.close();
      this.manager.onWindowClosed(this);
    });

    wc.on('before-input-event', (event, input) => this.handleInput(event, input, null));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('render-process-gone', () => {
      // The browser UI itself crashed: reload it, tabs are untouched.
      this.uiReady = false;
      wc.reload();
    });
  }

  // ---- messaging ------------------------------------------------------------------

  send(channel, data) {
    if (!this.win.isDestroyed() && !this.webContents.isDestroyed()) this.webContents.send(channel, data);
  }

  sendOverlay(channel, data) {
    if (!this.overlay) return;
    if (!this.overlayReady) {
      this.overlayQueue.push([channel, data]);
      return;
    }
    if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(channel, data);
  }

  initialState() {
    return {
      private: this.isPrivate,
      platform: process.platform,
      settings: settings.data,
      lang: lang(),
      version: app.getVersion(),
      bookmarks: bookmarks.list(),
      downloads: downloads.progress(),
      hasDownloads: downloads.list().length > 0,
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      update: this.manager.updateState,
    };
  }

  onUiReady() {
    trace.mark('browser UI ready');
    this.uiReady = true;
    this.send('state:init', this.initialState());
    this.sendTabs();
    setTimeout(this.reveal, 20);
    this.scheduleSpareTab(4000);
  }

  // A new tab page loaded in advance (in the background, not shown), so a new
  // tab opens instantly instead of starting a page from scratch. Replaced a
  // moment after it is used.
  scheduleSpareTab(delay = 800) {
    clearTimeout(this.spareTimer);
    this.spareTimer = setTimeout(() => this.prepareSpareTab(), delay);
  }

  prepareSpareTab() {
    if (this.spareTab || this.win.isDestroyed()) return;
    if (!settings.get('performance.preloadNewTab') || this.manager.efficiencyActive() || os.totalmem() < SPARE_TAB_MIN_MEMORY) return;
    const tab = new Tab(this, { url: Tab.NEW_TAB });
    tab.createView();
    if (this.pageBounds) tab.view.setBounds(this.pageBounds);
    tab.wc.loadURL(Tab.NEW_TAB).catch(() => {});
    this.spareTab = tab;
  }

  takeSpareTab() {
    const tab = this.spareTab;
    if (tab?.wc?.isCrashed()) {
      tab.destroy();
      this.spareTab = null;
      this.scheduleSpareTab();
    }
    if (!this.spareTab?.wc || tab.wc.isLoading()) return null;
    this.spareTab = null;
    this.scheduleSpareTab();
    return tab;
  }

  tabChanged(tab) {
    if (tab.id === this.activeId && !this.win.isDestroyed()) {
      const title = tab.title && tab.title !== tab.url ? `${tab.title} – Imp` : 'Imp';
      if (this.win.getTitle() !== title) this.win.setTitle(this.isPrivate ? `${title} (${t('private')})` : title);
    }
    if (this.sendTimer) return;
    this.sendTimer = setTimeout(() => this.sendTabs(), 16);
  }

  sendTabs() {
    clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (!this.uiReady) return;
    const active = this.activeTab();
    this.send('state:tabs', {
      tabs: this.tabs.map((tab) => tab.state()),
      activeId: this.activeId,
      split: this.split,
      splitRatio: this.splitRatio,
      bookmarked: !!(active && bookmarks.findByUrl(active.displayUrl())),
    });
  }

  // ---- tabs --------------------------------------------------------------------------

  getTab(id) {
    return this.tabs.find((tab) => tab.id === id) || null;
  }

  activeTab() {
    return this.getTab(this.activeId);
  }

  pinnedCount() {
    return this.tabs.filter((tab) => tab.pinned).length;
  }

  indexAfterOpener(opener) {
    let i = this.tabs.indexOf(opener) + 1;
    while (i < this.tabs.length && this.tabs[i].openerId === opener.id) i++;
    return i;
  }

  createTab({ url, active = true, index, pinned, sleeping, entries, entryIndex, title, favicon, openerId, typed, loadOptions } = {}) {
    const spare = (!url || url === Tab.NEW_TAB) && !sleeping && !entries?.length ? this.takeSpareTab() : null;
    const tab = spare || new Tab(this, { url: url || Tab.NEW_TAB, pinned, entries, entryIndex, title, favicon, openerId });
    tab.typed = !!typed;
    if (spare) {
      tab.pinned = !!pinned;
      tab.openerId = openerId ?? null;
      tab.lastActive = Date.now();
    } else if (sleeping) {
      tab.sleeping = true;
    } else {
      tab.createView();
      if (entries && entries.length) tab.restoreOrLoad();
      else tab.wc.loadURL(tab.url, loadOptions).catch(() => {});
    }
    const pins = this.pinnedCount();
    let i = index ?? this.tabs.length;
    i = tab.pinned ? Math.min(i, pins) : Math.max(i, pins);
    this.tabs.splice(Math.min(i, this.tabs.length), 0, tab);
    if (active || this.activeId == null) this.activate(tab.id);
    else this.sendTabs();
    this.manager.saveSoon();
    return tab;
  }

  // Session restore: every tab starts asleep, only the active one loads.
  restoreTabs(snaps, activeIndex = 0) {
    for (const snap of snaps) {
      if (!snap || !snap.url) continue;
      const tab = new Tab(this, snap);
      tab.sleeping = true;
      this.tabs.push(tab);
    }
    this.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    if (!this.tabs.length) {
      this.createTab({});
      return;
    }
    const target = this.tabs[Math.min(Math.max(activeIndex || 0, 0), this.tabs.length - 1)];
    this.activate(target.id);
  }

  // window.open() and target=_blank links. Sized popups (typically sign-in
  // windows that report back to their opener) stay real popup windows;
  // everything else opens as a tab next to the page that opened it.
  handleWindowOpen(opener, details) {
    const { url, disposition, features } = details;
    if (/^(javascript|file):/i.test(url)) return { action: 'deny' };
    // The new page lives in the opener's session; it gets the same preferences as any tab.
    const webPreferences = Tab.webPreferences();
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: ICON, backgroundColor: '#ffffff', webPreferences },
      };
    }
    // Links and tab-style window.open() calls become regular Imp tabs. (Electron
    // can hand over a ready-made page instead, but that one would miss the tab
    // preferences above — preload, passkey setting — and break Google sign-in.)
    const post = details.postBody;
    this.createTab({
      url,
      active: disposition !== 'background-tab',
      index: this.indexAfterOpener(opener),
      openerId: opener.id,
      loadOptions: {
        httpReferrer: details.referrer,
        ...(post && {
          postData: post.data,
          extraHeaders: `content-type: ${post.contentType}${post.boundary ? `; boundary=${post.boundary}` : ''}`,
        }),
      },
    });
    return { action: 'deny' };
  }

  activate(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    if (this.split && id !== this.split.left && id !== this.split.right) this.split = null;
    const prev = this.activeTab();
    if (prev) prev.lastActive = Date.now();
    this.activeId = id;
    tab.lastActive = Date.now();
    if (tab.sleeping || !tab.view) tab.wake();
    this.layout();
    this.closePopup(null, true);
    this.hideBubble();
    this.focusActive();
    this.tabChanged(tab);
    this.sendTabs();
    this.manager.saveSoon();
  }

  focusOmnibox(opts = { select: true }) {
    this.webContents.focus();
    this.send('ui:focus-omnibox', opts);
  }

  focusActive() {
    const tab = this.activeTab();
    if (!tab) return;
    if (tab.url === Tab.NEW_TAB && !this.split) {
      // The new tab page grabs focus when it finishes loading; keep the address
      // bar focused for a moment so you can type right away (see Tab 'focus').
      tab.omniboxFocusUntil = Date.now() + 2500;
      this.focusOmnibox();
    } else {
      tab.wc?.focus();
    }
  }

  closeTab(id, { remember = true } = {}) {
    const idx = this.tabs.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    if (remember && !this.isPrivate) {
      const snap = tab.snapshot();
      if (snap.url && snap.url !== Tab.NEW_TAB) this.manager.pushClosed({ ...snap, index: idx });
    }
    this.tabs.splice(idx, 1);
    if (this.split && (this.split.left === id || this.split.right === id)) {
      const other = this.split.left === id ? this.split.right : this.split.left;
      this.split = null;
      if (this.activeId === id) this.activeId = other;
    }
    if (this.fullscreenTab === tab) this.fullscreenTab = null;
    tab.destroy();
    if (!this.tabs.length) {
      this.win.close();
      return;
    }
    if (this.activeId === id) {
      const opener = tab.openerId != null ? this.getTab(tab.openerId) : null;
      const next = opener || this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = null;
      this.activate(next.id);
    } else {
      this.layout();
      this.sendTabs();
    }
    this.manager.saveSoon();
  }

  closeOtherTabs(id) {
    for (const tab of [...this.tabs]) if (tab.id !== id && !tab.pinned) this.closeTab(tab.id);
  }

  closeTabsToRight(id) {
    const idx = this.tabs.findIndex((tab) => tab.id === id);
    for (const tab of this.tabs.slice(idx + 1)) this.closeTab(tab.id);
  }

  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((tab) => tab.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const pins = this.pinnedCount();
    let i = Math.max(0, Math.min(toIndex, this.tabs.length));
    i = tab.pinned ? Math.min(i, pins) : Math.max(i, pins);
    this.tabs.splice(i, 0, tab);
    this.sendTabs();
    this.manager.saveSoon();
  }

  pinTab(id, pinned) {
    const tab = this.getTab(id);
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    const pins = this.pinnedCount();
    this.tabs.splice(pins, 0, tab);
    this.sendTabs();
    this.manager.saveSoon();
  }

  duplicateTab(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    const snap = tab.snapshot();
    this.createTab({ ...snap, pinned: false, index: this.tabs.indexOf(tab) + 1, openerId: tab.id });
  }

  moveTabToNewWindow(id) {
    const tab = this.getTab(id);
    if (!tab || this.isPrivate || this.tabs.length < 2) return;
    const snap = tab.snapshot();
    this.closeTab(id, { remember: false });
    this.manager.createWindow({ tabs: [{ ...snap, pinned: false }] });
  }

  sleepTab(id) {
    const tab = this.getTab(id);
    if (!tab || tab.id === this.activeId || this.isInSplit(tab)) return;
    tab.sleep();
  }

  isInSplit(tab) {
    return !!this.split && (this.split.left === tab.id || this.split.right === tab.id);
  }

  isVisible(tab) {
    return tab.id === this.activeId || this.isInSplit(tab);
  }

  // ---- layout ------------------------------------------------------------------------

  setPageBounds(bounds) {
    this.pageBounds = bounds;
    this.layout();
  }

  detachView(view) {
    if (!this.attached.has(view)) return;
    this.attached.delete(view);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
  }

  layout() {
    if (!this.pageBounds || this.win.isDestroyed()) return;
    const visible = new Map();
    const ft = this.fullscreenTab;
    if (ft && ft.view) {
      const [width, height] = this.win.getContentSize();
      visible.set(ft.view, { x: 0, y: 0, width, height });
    } else if (this.split) {
      // Keep in sync with layoutSplit() in ui/ui.js, which draws the focus ring and divider.
      const pb = this.pageBounds;
      const gap = 8;
      const inset = 4;
      const x = pb.x + inset;
      const y = pb.y + inset;
      const width = pb.width - inset * 2;
      const height = pb.height - inset * 2;
      const lw = Math.round((width - gap) * this.splitRatio);
      const left = this.getTab(this.split.left);
      const right = this.getTab(this.split.right);
      if (left?.view) visible.set(left.view, { x, y, width: lw, height });
      if (right?.view) visible.set(right.view, { x: x + lw + gap, y, width: width - lw - gap, height });
    } else {
      const tab = this.activeTab();
      if (tab?.view) visible.set(tab.view, { ...this.pageBounds });
    }
    for (const v of [...this.attached]) if (!visible.has(v)) this.detachView(v);
    const rounded = !!this.split && !ft;
    for (const [view, bounds] of visible) {
      view.setBounds(bounds);
      view.setBorderRadius(rounded ? 10 : 0);
      if (!this.attached.has(view)) {
        this.win.contentView.addChildView(view, 0);
        this.attached.add(view);
      }
    }
  }

  setHtmlFullscreen(tab, on) {
    if (on) {
      this.fullscreenTab = tab;
      this.wasFullscreen = this.win.isFullScreen();
      if (!this.wasFullscreen) this.win.setFullScreen(true);
    } else if (this.fullscreenTab === tab) {
      this.fullscreenTab = null;
      if (!this.wasFullscreen && this.win.isFullScreen()) this.win.setFullScreen(false);
    }
    this.closePopup(null, true);
    this.send('ui:html-fullscreen', on);
    this.layout();
  }

  // ---- split view ----------------------------------------------------------------------

  toggleSplit(withId) {
    if (this.split && withId == null) {
      this.split = null;
      this.layout();
      this.sendTabs();
      return;
    }
    const active = this.activeTab();
    if (!active) return;
    let other = withId != null ? this.getTab(withId) : null;
    if (!other || other === active) {
      other = this.tabs
        .filter((tab) => tab !== active)
        .sort((a, b) => b.lastActive - a.lastActive)[0];
    }
    if (!other) other = this.createTab({ active: false, index: this.tabs.indexOf(active) + 1 });
    if (other.sleeping || !other.view) other.wake();
    this.split = { left: active.id, right: other.id };
    this.splitRatio = 0.5;
    this.layout();
    this.sendTabs();
  }

  setSplitRatio(ratio) {
    this.splitRatio = Math.min(0.8, Math.max(0.2, Number(ratio) || 0.5));
    this.layout();
  }

  // ---- focus / input -----------------------------------------------------------------

  onTabFocus(tab) {
    if (this.split && this.isInSplit(tab) && this.activeId !== tab.id) {
      this.activeId = tab.id;
      tab.lastActive = Date.now();
      this.tabChanged(tab);
      this.sendTabs();
    }
    if (this.popup && this.popup.type !== 'suggest' && this.popup.type !== 'pwfill') this.closePopup(null, true);
  }

  onTabNavigated(tab) {
    if (this.isVisible(tab)) this.hideBubble('status');
    this.manager.saveSoon();
    this.manager.notifyPages();
  }

  handleInput(event, input, tab) {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && tab) {
      if (this.fullscreenTab === tab) {
        tab.wc?.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      } else if (tab.loading) {
        tab.stop();
      }
      return;
    }
    const cmd = shortcuts.match(input);
    if (!cmd) return;
    event.preventDefault();
    this.command(cmd.name, cmd.arg);
  }

  // ---- popups & bubbles ------------------------------------------------------------------

  ensureOverlay() {
    if (this.overlay) return this.overlay;
    const view = new WebContentsView({
      webPreferences: { preload: UI_PRELOAD, partition: 'persist:imp-ui', sandbox: true, contextIsolation: true, spellcheck: true },
    });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    wc.loadFile(OVERLAY_HTML, { query: { private: this.isPrivate ? '1' : '0', platform: process.platform } });
    wc.on('before-input-event', (event, input) => this.handleInput(event, input, null));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('blur', () => {
      setTimeout(() => {
        if (this.popup?.focus && !wc.isDestroyed() && !wc.isFocused()) this.closePopup(null, true);
      }, 30);
    });
    wc.on('focus', () => {
      if (this.popup?.type === 'pwsave') this.popup.focus = true;
    });
    this.overlay = view;
    return view;
  }

  onOverlayReady() {
    this.overlayReady = true;
    this.overlay.webContents.send('state:init', this.initialState());
    for (const [channel, data] of this.overlayQueue) this.overlay.webContents.send(channel, data);
    this.overlayQueue = [];
  }

  attachOverlay(bounds) {
    if (this.win.isDestroyed()) return;
    this.overlay.setBounds(bounds);
    this.win.contentView.addChildView(this.overlay);
    this.overlayAttached = true;
  }

  detachOverlay() {
    if (!this.overlayAttached || this.win.isDestroyed()) return;
    this.win.contentView.removeChildView(this.overlay);
    this.overlayAttached = false;
  }

  openPopup(type, anchor, data = {}) {
    this.ensureOverlay();
    this.bubble = null;
    const id = ++popupSeq;
    // The address bar suggestions and the saved-password list leave the keyboard where
    // it is; the save-password prompt takes it only once you click into it.
    const focus = !['suggest', 'pwfill', 'pwsave'].includes(type);
    this.popup = { id, type, anchor, align: anchor?.align || 'left', focus, focused: false };
    const [, ch] = this.win.getContentSize();
    const maxHeight = Math.max(160, ch - Math.round((anchor?.y || 0) + (anchor?.height || 0)) - 8);
    this.sendOverlay('popup:show', { id, type, data, maxHeight });
    return id;
  }

  updatePopup(type, data) {
    if (this.popup?.type !== type) return;
    this.sendOverlay('popup:update', { id: this.popup.id, type, data });
  }

  onOverlaySize({ id, kind, width, height }) {
    if (this.win.isDestroyed()) return;
    const [cw, ch] = this.win.getContentSize();
    if (kind === 'popup') {
      if (!this.popup || this.popup.id !== id) return;
      // The overlay page keeps a transparent margin of POPUP_PAD around each popup for its shadow.
      const POPUP_PAD = 18;
      const a = this.popup.anchor || { x: 0, y: 0, width: cw, height: 0 };
      let x;
      if (this.popup.align === 'right') x = a.x + a.width - width + POPUP_PAD;
      else if (this.popup.align === 'center') x = Math.round((cw - width) / 2);
      else x = a.x - POPUP_PAD;
      const y = Math.max(0, Math.round(a.y + a.height + (a.gap ?? 4) - POPUP_PAD));
      x = Math.max(0, Math.min(x, cw - width));
      this.attachOverlay({ x: Math.round(x), y, width: Math.round(width), height: Math.round(Math.min(height, ch - y)) });
      if (this.popup.focus && !this.popup.focused) {
        this.popup.focused = true;
        this.overlay.webContents.focus();
      }
    } else if (kind === 'bubble') {
      if (!this.bubble || this.bubble.id !== id || this.popup) return;
      const pb = this.pageBounds || { x: 0, y: 0, width: cw, height: ch };
      let x = pb.x;
      const y = pb.y + pb.height - height;
      if (this.bubble.kind === 'toast') {
        x = pb.x + Math.round((pb.width - width) / 2);
      } else {
        const cur = screen.getCursorScreenPoint();
        const cb = this.win.getContentBounds();
        const rx = cur.x - cb.x;
        const ry = cur.y - cb.y;
        if (rx < x + width + 40 && ry > y - 40) x = pb.x + pb.width - width;
      }
      this.attachOverlay({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    }
  }

  closePopup(type, auto = false) {
    if (!this.popup || (type && this.popup.type !== type)) return;
    const closed = this.popup;
    this.popup = null;
    if (closed.type === 'auth' && this.pendingAuth) this.finishAuth(null);
    if (closed.type === 'pwfill') autofill.listClosed(this);
    const hadFocus = this.overlay && !this.overlay.webContents.isDestroyed() && this.overlay.webContents.isFocused();
    this.detachOverlay();
    this.sendOverlay('popup:hide', { id: closed.id });
    this.send('ui:popup-closed', { type: closed.type, auto });
    if (hadFocus && !auto) this.focusActive();
  }

  showStatus(tab, url) {
    if (!this.isVisible(tab) || this.fullscreenTab) return;
    if (!url) return this.hideBubble('status');
    if (this.popup) return;
    let text = url;
    try {
      text = decodeURI(url);
    } catch {}
    this.showBubble('status', text);
  }

  showBubble(kind, text, action) {
    if (this.popup) return;
    this.ensureOverlay();
    const id = ++popupSeq;
    this.bubble = { id, kind, action };
    this.sendOverlay('bubble:show', { id, kind, text, action: action ? action.label : null });
    clearTimeout(this.bubbleTimer);
    if (kind === 'toast') this.bubbleTimer = setTimeout(() => this.hideBubble('toast'), 4000);
  }

  hideBubble(kind) {
    if (!this.bubble || (kind && this.bubble.kind !== kind)) return;
    this.bubble = null;
    if (!this.popup) this.detachOverlay();
    this.sendOverlay('bubble:hide', {});
  }

  toast(text, action) {
    this.showBubble('toast', text, action);
  }

  onBubbleAction() {
    const action = this.bubble?.action;
    this.hideBubble();
    if (action?.run) action.run();
  }

  // ---- find in page ----------------------------------------------------------------------

  find(text, { forward = true, newSession = true } = {}) {
    const tab = this.activeTab();
    if (!tab?.wc) return;
    if (!text) {
      tab.wc.stopFindInPage('clearSelection');
      tab.findResult = null;
      this.sendFindResult(tab);
      return;
    }
    tab.wc.findInPage(text, { forward, findNext: newSession });
  }

  stopFind() {
    const tab = this.activeTab();
    tab?.wc?.stopFindInPage('keepSelection');
    if (tab) tab.findResult = null;
  }

  sendFindResult(tab) {
    if (tab.id === this.activeId) this.send('state:find', tab.findResult);
  }

  // ---- permissions -------------------------------------------------------------------------

  requestPermission(tab, request) {
    tab.permissionRequests.push(request);
    tab.changed();
    if (tab.id !== this.activeId) this.send('ui:attention', tab.id);
  }

  requestAuth(tab, info, callback) {
    if (this.pendingAuth) this.pendingAuth.callback();
    this.pendingAuth = { callback, tabId: tab.id };
    if (tab.id !== this.activeId) this.activate(tab.id);
    const [cw] = this.win.getContentSize();
    const top = this.pageBounds ? this.pageBounds.y : 80;
    this.openPopup('auth', { x: 0, y: top, width: cw, height: 0, align: 'center', gap: 24 }, info);
  }

  finishAuth(user, pass) {
    const pending = this.pendingAuth;
    this.pendingAuth = null;
    if (!pending) return;
    if (user != null) pending.callback(String(user), String(pass || ''));
    else pending.callback();
  }

  respondPermission(tabId, allow) {
    const tab = this.getTab(tabId);
    const req = tab?.permissionRequests.shift();
    if (!req) return;
    req.callback(!!allow, true);
    tab.changed();
  }

  // ---- zoom ----------------------------------------------------------------------------------

  stepZoom(tab, dir) {
    if (!tab?.wc) return;
    const current = tab.wc.getZoomFactor();
    let next;
    if (dir === 0) next = 1;
    else if (dir > 0) next = ZOOM_STEPS.find((z) => z > current + 0.001) || 5;
    else next = [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) || 0.25;
    tab.setZoom(next);
  }

  // ---- actions ---------------------------------------------------------------------------------

  openInternal(page, hash = '') {
    const url = `imp://${page}/${hash}`;
    const existing = this.tabs.find((tab) => tab.displayUrl().startsWith(`imp://${page}/`));
    if (existing) {
      if (hash && existing.wc) existing.load(url);
      this.activate(existing.id);
      return existing;
    }
    const active = this.activeTab();
    if (active && active.displayUrl() === Tab.NEW_TAB && !active.loading) {
      active.load(url);
      return active;
    }
    return this.createTab({ url });
  }

  navigate(text, { disposition = 'current', typed = true } = {}) {
    const omnibox = require('./omnibox');
    const resolved = omnibox.resolve(text);
    if (!resolved) return;
    const tab = this.activeTab();
    if (disposition === 'new-tab' || !tab) {
      this.createTab({ url: resolved.url, typed });
    } else if (disposition === 'background-tab') {
      this.createTab({ url: resolved.url, active: false, index: this.indexAfterOpener(tab), openerId: tab.id });
    } else {
      tab.typed = typed;
      tab.load(resolved.url);
      tab.omniboxFocusUntil = 0;
      tab.wc?.focus();
    }
  }

  async toggleReader(tab) {
    if (!tab?.wc) return;
    if (tab.url.startsWith('imp://reader/')) {
      tab.goBack();
      return;
    }
    const article = await tab.extractArticle();
    if (!article || !article.content) {
      this.toast(t('toast.noArticle'));
      return;
    }
    const id = reader.put({ ...article, url: tab.url });
    tab.load(`imp://reader/?id=${id}`);
  }

  async screenshot(tab, full) {
    const wc = tab?.wc;
    if (!wc) return;
    let image = null;
    if (full) {
      try {
        image = await captureFullPage(wc);
      } catch (err) {
        console.warn('[capture] full page failed', err.message);
      }
    }
    if (!image) image = await wc.capturePage();
    clipboard.writeImage(image);
    const dir = path.join(app.getPath('pictures'), 'Imp');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(dir, `Imp ${stamp}.png`);
    fs.writeFileSync(file, image.toPNG());
    this.toast(t('toast.screenshot'), { label: t('toast.showFile'), run: () => shell.showItemInFolder(file) });
  }

  async savePage(tab) {
    const wc = tab?.wc;
    if (!wc) return;
    const name = (tab.title || 'page').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100);
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      defaultPath: path.join(downloads.dir(), `${name}.html`),
      filters: [
        { name: t('dlg.pageComplete'), extensions: ['html'] },
        { name: t('dlg.pageHtmlOnly'), extensions: ['htm'] },
      ],
    });
    if (canceled || !filePath) return;
    try {
      await wc.savePage(filePath, filePath.endsWith('.htm') ? 'HTMLOnly' : 'HTMLComplete');
      this.toast(t('toast.saved'), { label: t('toast.showFile'), run: () => shell.showItemInFolder(filePath) });
    } catch (err) {
      this.toast(t('toast.saveFailed'));
    }
  }

  showPageMenu(tab, params) {
    menus.page(this, tab, params);
  }

  command(name, arg) {
    const tab = this.activeTab();
    switch (name) {
      case 'new-tab':
        return this.createTab({ url: arg?.url });
      case 'new-window':
        return this.manager.createWindow({});
      case 'new-private-window':
        return this.manager.createWindow({ private: true });
      case 'close-tab':
        return tab && this.closeTab(tab.id);
      case 'close-window':
        return this.win.close();
      case 'reopen-closed-tab':
        return this.manager.reopenClosed(this);
      case 'next-tab':
      case 'prev-tab': {
        if (!tab) return;
        const i = this.tabs.indexOf(tab);
        const n = this.tabs.length;
        return this.activate(this.tabs[(i + (name === 'next-tab' ? 1 : -1) + n) % n].id);
      }
      case 'select-tab': {
        const target = arg >= 9 ? this.tabs[this.tabs.length - 1] : this.tabs[arg - 1];
        return target && this.activate(target.id);
      }
      case 'focus-omnibox':
        return this.focusOmnibox({ select: true, recent: true });
      case 'focus-page':
        return tab?.wc?.focus();
      case 'reload':
        return tab?.reload(false);
      case 'hard-reload':
        return tab?.reload(true);
      case 'stop':
        return tab?.stop();
      case 'back':
        return tab?.goBack();
      case 'forward':
        return tab?.goForward();
      case 'home':
        return tab?.load(settings.get('startup.homepage') || Tab.NEW_TAB);
      case 'find':
        this.webContents.focus();
        return this.send('ui:find', {});
      case 'find-next':
      case 'find-prev':
        return this.send('ui:find-step', { forward: name === 'find-next' });
      case 'zoom-in':
        return this.stepZoom(tab, 1);
      case 'zoom-out':
        return this.stepZoom(tab, -1);
      case 'zoom-reset':
        return this.stepZoom(tab, 0);
      case 'bookmark-page':
        this.webContents.focus();
        return this.send('ui:bookmark-page', {});
      case 'toggle-bookmarks-bar':
        return settings.set('appearance.bookmarksBar', settings.get('appearance.bookmarksBar') === 'always' ? 'never' : 'always');
      case 'open-bookmarks':
        return this.openInternal('bookmarks');
      case 'open-passwords':
        return this.openInternal('passwords');
      case 'open-history':
        return this.openInternal('history');
      case 'open-downloads':
        return this.openInternal('downloads');
      case 'open-settings':
        return this.openInternal('settings', arg ? `#${arg}` : '');
      case 'open-performance':
        return this.openInternal('performance');
      case 'about':
        return this.openInternal('settings', '#about');
      case 'clear-data':
        return this.openInternal('settings', '#privacy');
      case 'fullscreen':
        return this.win.setFullScreen(!this.win.isFullScreen());
      case 'devtools':
        return tab?.wc?.toggleDevTools();
      case 'print':
        return tab?.wc?.print();
      case 'save-page':
        return this.savePage(tab);
      case 'view-source':
        return tab && /^https?:/.test(tab.url) && this.createTab({ url: `view-source:${tab.url}`, index: this.tabs.indexOf(tab) + 1 });
      case 'command-palette':
        this.webContents.focus();
        return this.send('ui:palette', {});
      case 'reader':
        return this.toggleReader(tab);
      case 'screenshot':
        return this.screenshot(tab, false);
      case 'screenshot-full':
        return this.screenshot(tab, true);
      case 'translate':
        if (!tab || !/^https?:/.test(tab.url)) return;
        return this.createTab({
          url: `https://translate.google.com/translate?sl=auto&tl=${lang()}&u=${encodeURIComponent(tab.url)}`,
          index: this.tabs.indexOf(tab) + 1,
          openerId: tab.id,
        });
      case 'toggle-split':
        return this.toggleSplit(arg);
      case 'toggle-vertical-tabs':
        return settings.set('appearance.verticalTabs', !settings.get('appearance.verticalTabs'));
      case 'mute-tab': {
        const target = arg != null ? this.getTab(arg) : tab;
        return target && target.setMuted(!target.muted);
      }
      case 'pin-tab': {
        const target = arg != null ? this.getTab(arg) : tab;
        return target && this.pinTab(target.id, !target.pinned);
      }
      case 'duplicate-tab':
        return tab && this.duplicateTab(arg ?? tab.id);
      case 'sleep-tab':
        return arg != null && this.sleepTab(arg);
      case 'shields-panel':
        this.webContents.focus();
        return this.send('ui:open-popup', { type: 'shields' });
      case 'restart-update':
        return this.manager.installUpdate();
      case 'quit':
        return app.quit();
      default:
        return undefined;
    }
  }
}

async function captureFullPage(wc) {
  const dbg = wc.debugger;
  let attached = false;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
    attached = true;
  }
  try {
    const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    const width = Math.ceil(size.width);
    const height = Math.min(Math.ceil(size.height), 16000);
    const res = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return nativeImage.createFromBuffer(Buffer.from(res.data, 'base64'));
  } finally {
    if (attached) dbg.detach();
  }
}

module.exports = BrowserWin;
