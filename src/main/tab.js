'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { WebContentsView, dialog } = require('electron');
const history = require('./history');
const omnibox = require('./omnibox');
const shields = require('./shields');
const settings = require('./settings');
const errorPage = require('./error-page');
const autofill = require('./autofill');
const { JsonFile } = require('./store');
const { t } = require('./i18n');
const trace = require('./trace');

const PAGE_PRELOAD = path.join(__dirname, '../preload/page.js');
const NEW_TAB = 'imp://newtab/';
const MAX_ENTRIES = 30;
const zoomStore = new JsonFile('zoom.json', {});
let readabilitySource = null;
let nextId = 1;

const READERABLE_CHECK = `(() => {
  let n = 0;
  for (const p of document.querySelectorAll('p')) {
    if ((p.textContent || '').trim().length > 140 && ++n >= 4) return true;
  }
  return n >= 2 && !!document.querySelector('article');
})()`;

class Tab {
  constructor(win, opts = {}) {
    this.id = nextId++;
    this.win = win;
    this.url = opts.url || NEW_TAB;
    this.title = opts.title || '';
    this.favicon = opts.favicon || '';
    this.pinned = !!opts.pinned;
    this.muted = false;
    this.audible = false;
    this.loading = false;
    this.sleeping = false;
    this.crashed = false;
    this.readerable = false;
    this.blocked = 0;
    this.blockedHosts = new Map();
    this.zoom = 1;
    this.lastActive = Date.now();
    this.openerId = opts.openerId ?? null;
    this.entries = opts.entries || null;
    this.entryIndex = opts.entryIndex;
    this.permissionRequests = [];
    this.findResult = null;
    this.canGoBack = false;
    this.canGoForward = false;
    this.typed = false;
    this.errorUrl = null;
    this.view = null;
  }

  get wc() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  get isPrivate() {
    return this.win.isPrivate;
  }

  // ---- lifecycle ---------------------------------------------------------------

  createView() {
    this.view = new WebContentsView({ webPreferences: { ...Tab.webPreferences(), session: this.win.session } });
    this.view.setBackgroundColor(this.url.startsWith('imp:') ? this.win.pageBackground() : '#FFFFFF');
    this.attachEvents(this.view.webContents);
    if (this.muted) this.view.webContents.setAudioMuted(true);
    return this.view;
  }

  load(url) {
    this.url = url;
    this.errorUrl = null;
    if (!this.wc) {
      if (this.sleeping) return this.wake();
      this.createView();
    }
    this.view.setBackgroundColor(url.startsWith('imp:') ? this.win.pageBackground() : '#FFFFFF');
    this.wc.loadURL(url).catch(() => {});
    this.changed();
  }

  restoreOrLoad() {
    const wc = this.wc;
    if (!wc) return;
    const entries = this.entries;
    this.entries = null;
    if (entries && entries.length) {
      const index = Math.min(Math.max(this.entryIndex ?? entries.length - 1, 0), entries.length - 1);
      wc.navigationHistory.restore({ entries, index }).catch(() => wc.loadURL(this.url).catch(() => {}));
    } else {
      wc.loadURL(this.url).catch(() => {});
    }
  }

  sleep() {
    const wc = this.wc;
    if (!wc || this.sleeping) return false;
    this.captureHistory();
    this.url = this.errorUrl || wc.getURL() || this.url;
    this.destroyView();
    this.sleeping = true;
    this.loading = false;
    this.audible = false;
    this.changed();
    return true;
  }

  wake() {
    if (this.view) return;
    this.sleeping = false;
    this.createView();
    this.restoreOrLoad();
    this.changed();
  }

  captureHistory() {
    const wc = this.wc;
    if (!wc) return;
    try {
      const nh = wc.navigationHistory;
      let entries = nh.getAllEntries();
      let index = nh.getActiveIndex();
      if (entries.length > MAX_ENTRIES) {
        const cut = entries.length - MAX_ENTRIES;
        entries = entries.slice(cut);
        index = Math.max(0, index - cut);
      }
      this.entries = entries
        .filter((e) => e.url)
        .map((e) => ({ url: e.url, title: e.title, ...(e.pageState && e.pageState.length < 65536 ? { pageState: e.pageState } : {}) }));
      this.entryIndex = Math.min(index, this.entries.length - 1);
    } catch {
      this.entries = null;
    }
  }

  destroyView() {
    if (!this.view) return;
    this.win.detachView(this.view);
    const wc = this.view.webContents;
    shields.forget(wc.id);
    if (!wc.isDestroyed()) wc.close();
    this.view = null;
  }

  destroy() {
    this.permissionRequests.forEach((r) => r.callback(false));
    this.permissionRequests = [];
    this.destroyView();
  }

  snapshot() {
    if (this.wc) this.captureHistory();
    return {
      url: this.errorUrl || (this.wc ? this.wc.getURL() : this.url) || this.url,
      title: this.title,
      favicon: this.favicon,
      pinned: this.pinned,
      entries: this.entries,
      entryIndex: this.entryIndex,
    };
  }

  // ---- state -------------------------------------------------------------------

  changed() {
    this.win.tabChanged(this);
  }

  displayUrl() {
    return this.errorUrl || this.url;
  }

  state() {
    const url = this.displayUrl();
    return {
      id: this.id,
      url,
      title: this.title || (url === NEW_TAB ? '' : url),
      favicon: this.favicon,
      loading: this.loading,
      audible: this.audible,
      muted: this.muted,
      pinned: this.pinned,
      sleeping: this.sleeping,
      crashed: this.crashed,
      error: !!this.errorUrl,
      readerable: this.readerable,
      blocked: this.blocked,
      zoom: this.zoom,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      shieldsOn: !shields.isAllowlisted(shields.hostOf(url)),
      permission: this.permissionRequests[0] ? { origin: this.permissionRequests[0].origin, kinds: this.permissionRequests[0].kinds } : null,
      passwordOffer: !!this.passwordOffer,
    };
  }

  updateNav() {
    const wc = this.wc;
    if (!wc) return;
    this.canGoBack = wc.navigationHistory.canGoBack();
    this.canGoForward = wc.navigationHistory.canGoForward();
  }

  // ---- navigation --------------------------------------------------------------

  goBack() {
    if (this.sleeping) this.wake();
    if (this.wc?.navigationHistory.canGoBack()) this.wc.navigationHistory.goBack();
  }

  goForward() {
    if (this.sleeping) this.wake();
    if (this.wc?.navigationHistory.canGoForward()) this.wc.navigationHistory.goForward();
  }

  reload(hard = false) {
    if (this.sleeping) return this.wake();
    if (!this.wc) return;
    if (this.crashed || this.errorUrl) return this.load(this.errorUrl || this.url);
    if (hard) this.wc.reloadIgnoringCache();
    else this.wc.reload();
  }

  stop() {
    this.wc?.stop();
  }

  setMuted(muted) {
    this.muted = muted;
    this.wc?.setAudioMuted(muted);
    this.changed();
  }

  applyZoom() {
    const wc = this.wc;
    if (!wc) return;
    const host = shields.hostOf(wc.getURL());
    const z = (host && zoomStore.data[host]) || 1;
    if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z);
    this.zoom = z;
  }

  setZoom(factor) {
    const wc = this.wc;
    if (!wc) return;
    const z = Math.min(5, Math.max(0.25, Math.round(factor * 100) / 100));
    wc.setZoomFactor(z);
    this.zoom = z;
    const host = shields.hostOf(wc.getURL());
    if (host && !this.isPrivate) {
      if (z === 1) delete zoomStore.data[host];
      else zoomStore.data[host] = z;
      zoomStore.save();
    }
    this.changed();
  }

  // ---- reader mode ---------------------------------------------------------------

  async extractArticle() {
    const wc = this.wc;
    if (!wc) return null;
    if (!readabilitySource) {
      readabilitySource = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
    }
    const code = `(() => { ${readabilitySource}
      const doc = document.cloneNode(true);
      const a = new Readability(doc, { charThreshold: 400 }).parse();
      return a && { title: a.title, byline: a.byline, content: a.content, siteName: a.siteName, length: a.length,
        excerpt: a.excerpt, lang: document.documentElement.lang || '', dir: a.dir || '' };
    })()`;
    try {
      return await wc.executeJavaScriptInIsolatedWorld(1001, [{ code }]);
    } catch (err) {
      console.warn('[reader] extraction failed', err.message);
      return null;
    }
  }

  // ---- events --------------------------------------------------------------------

  attachEvents(wc) {
    wc.setWindowOpenHandler((details) => this.win.handleWindowOpen(this, details));

    wc.on('did-start-loading', () => {
      this.loading = true;
      this.changed();
    });

    wc.on('did-stop-loading', () => {
      trace.mark('first page loaded');
      this.loading = false;
      this.updateNav();
      this.changed();
      if (/^https?:/.test(wc.getURL())) {
        wc.executeJavaScript(READERABLE_CHECK)
          .then((ok) => {
            if (this.readerable !== !!ok) {
              this.readerable = !!ok;
              this.changed();
            }
          })
          .catch(() => {});
      }
    });

    wc.on('did-start-navigation', (event, ...legacy) => {
      const isMainFrame = event.isMainFrame ?? legacy[2];
      const isSameDocument = event.isSameDocument ?? legacy[1];
      const url = event.url ?? legacy[0];
      if (!isMainFrame || isSameDocument || !url) return;
      if (this.view) this.view.setBackgroundColor(url.startsWith('imp:') ? this.win.pageBackground() : '#FFFFFF');
      // Deny permission prompts that belong to the page we are leaving.
      if (this.permissionRequests.length) {
        this.permissionRequests.forEach((r) => r.callback(false));
        this.permissionRequests = [];
        this.changed();
      }
    });

    wc.on('did-navigate', (event, url) => {
      if (this.pendingCrash && url === 'about:blank') {
        this.errorUrl = this.pendingCrash;
        this.pendingCrash = null;
        this.crashed = true;
        this.showError({ kind: 'crash', url: this.errorUrl });
        this.updateNav();
        this.changed();
        return;
      }
      this.url = url;
      this.errorUrl = null;
      this.crashed = false;
      this.blocked = 0;
      this.blockedHosts.clear();
      this.readerable = false;
      this.findResult = null;
      this.updateNav();
      this.applyZoom();
      if (!this.isPrivate && settings.get('privacy.saveHistory')) {
        history.addVisit(url, wc.getTitle(), this.typed);
        const query = omnibox.queryFromUrl(url);
        if (query) history.addSearch(query);
      }
      this.typed = false;
      autofill.onNavigate(this);
      this.changed();
      this.win.onTabNavigated(this);
    });

    wc.on('did-navigate-in-page', (event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.updateNav();
      if (!this.isPrivate && settings.get('privacy.saveHistory')) {
        history.addVisit(url, wc.getTitle(), false);
        const query = omnibox.queryFromUrl(url);
        if (query) history.addSearch(query);
      }
      autofill.onNavigate(this);
      this.changed();
    });

    wc.on('page-title-updated', (event, title) => {
      this.title = title;
      if (!this.isPrivate) history.setTitle(wc.getURL(), title);
      this.changed();
    });

    wc.on('page-favicon-updated', (event, favicons) => {
      const icon = favicons.find((f) => /\.(svg|png)(\?|$)/i.test(f)) || favicons[0] || '';
      this.favicon = icon;
      if (!this.isPrivate) history.setFavicon(wc.getURL(), icon);
      this.changed();
    });

    wc.on('did-fail-load', (event, code, desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 || code === -27) return;
      const fallback = shields.httpsFallback(wc.id, validatedURL, code);
      if (fallback && !fallback.strict) {
        shields.allowHttp(fallback.host);
        wc.loadURL(fallback.httpUrl).catch(() => {});
        return;
      }
      this.errorUrl = validatedURL;
      this.pendingHttp = fallback ? fallback : null;
      const kind = fallback ? 'https' : 'network';
      this.showError({ kind, url: validatedURL, code, desc });
      this.loading = false;
      this.changed();
    });

    wc.on('render-process-gone', (event, details) => {
      if (details.reason === 'clean-exit') return;
      const url = this.errorUrl || this.url;
      this.loading = false;
      setImmediate(() => {
        if (!this.wc) return;
        this.pendingCrash = url;
        this.wc.loadURL('about:blank').catch(() => {});
      });
    });

    wc.on('console-message', (event, ...legacy) => {
      const msg = event.message ?? legacy[1];
      if (typeof msg !== 'string' || !msg.startsWith('__imp_')) return;
      if (!/^chrome-error:/.test(wc.getURL()) && !wc.getURL().startsWith('about:')) return;
      if (msg === '__imp_retry__') this.load(this.errorUrl || this.url);
      else if (msg === '__imp_back__') {
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        else this.load(NEW_TAB);
      } else if (msg === '__imp_http__' && this.pendingHttp) {
        shields.allowHttp(this.pendingHttp.host);
        this.load(this.pendingHttp.httpUrl);
      }
    });

    wc.on('audio-state-changed', (event) => {
      this.audible = !!event.audible;
      this.changed();
    });

    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(this, true));
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(this, false));

    wc.on('found-in-page', (event, result) => {
      this.findResult = { active: result.activeMatchOrdinal, total: result.matches };
      this.win.sendFindResult(this);
    });

    wc.on('context-menu', (event, params) => this.win.showPageMenu(this, params));
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') this.omniboxFocusUntil = 0;
      this.win.handleInput(event, input, this);
    });
    wc.on('before-mouse-event', (event, mouse) => {
      if (mouse.type === 'mouseDown') this.omniboxFocusUntil = 0;
    });
    wc.on('focus', () => {
      // A freshly opened new tab page took focus by itself: give it back to the address bar.
      if (this.omniboxFocusUntil > Date.now() && this.win.activeId === this.id) {
        setImmediate(() => this.win.focusOmnibox());
        return;
      }
      this.win.onTabFocus(this);
    });
    wc.on('update-target-url', (event, url) => this.win.showStatus(this, url));
    wc.on('zoom-changed', (event, direction) => this.win.stepZoom(this, direction === 'in' ? 1 : -1));

    wc.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(this.win.win, {
        type: 'question',
        buttons: [t('dlg.leave'), t('dlg.stay')],
        defaultId: 0,
        cancelId: 1,
        title: t('dlg.leaveTitle'),
        message: t('dlg.leaveTitle'),
        detail: t('dlg.leaveDetail'),
      });
      if (choice === 0) event.preventDefault();
    });
  }

  showError(opts) {
    const wc = this.wc;
    if (!wc) return;
    const run = () => wc.executeJavaScript(errorPage.script({ ...opts, accent: settings.get('appearance.accent') })).catch(() => {});
    run();
    wc.once('dom-ready', run);
  }

  // ---- shields bookkeeping ---------------------------------------------------------

  noteBlocked(url) {
    this.blocked++;
    const host = shields.hostOf(url);
    this.blockedHosts.set(host, (this.blockedHosts.get(host) || 0) + 1);
    this.changed();
  }
}

// Preferences for every web page Imp shows: tabs, and pages they open.
Tab.webPreferences = () => ({
  preload: PAGE_PRELOAD,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  plugins: true,
  spellcheck: true,
  safeDialogs: true,
  backgroundThrottling: true,
  scrollBounce: true,
  // Passkeys / security keys stay off unless enabled in settings: sites then
  // sign in with a password and Windows never shows the security-key dialog.
  ...(settings.get('privacy.passkeys') ? {} : { disableBlinkFeatures: 'WebAuth' }),
});

Tab.NEW_TAB = NEW_TAB;
module.exports = Tab;
