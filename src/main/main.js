'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, protocol, session, nativeTheme, Menu } = require('electron');

protocol.registerSchemesAsPrivileged([
  { scheme: 'imp', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

app.setAppUserModelId('io.github.imp.browser');

// Separate profile folder, e.g. for testing or portable use: IMP_PROFILE=D:\ImpProfile
if (process.env.IMP_PROFILE) app.setPath('userData', path.resolve(process.env.IMP_PROFILE));

const settings = require('./settings');
settings.load();

// ---- early, pre-ready tuning ------------------------------------------------------------
if (!settings.get('performance.hardwareAcceleration')) app.disableHardwareAcceleration();

// Present ourselves exactly like a regular Chromium browser (reduced UA), so
// websites don't serve degraded "unsupported browser" pages.
{
  const major = process.versions.chrome.split('.')[0];
  const platform = {
    win32: 'Windows NT 10.0; Win64; x64',
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  }[process.platform] || 'X11; Linux x86_64';
  app.userAgentFallback = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function urlsFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const out = [];
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    if (/^(https?|file|imp):/i.test(a)) out.push(a);
    else {
      try {
        const p = path.resolve(a);
        if (fs.statSync(p).isFile()) out.push(pathToFileURL(p).href);
      } catch {}
    }
  }
  return out;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  const history = require('./history');
  const bookmarks = require('./bookmarks');
  const downloads = require('./downloads');
  const permissions = require('./permissions');
  const shields = require('./shields');
  const internal = require('./internal');
  const ipc = require('./ipc');
  const updater = require('./updater');
  const manager = require('./windows');
  const { flushAll } = require('./store');
  const { lang } = require('./i18n');

  const pendingUrls = [];
  let ready = false;
  let cleared = false;

  app.on('second-instance', (event, argv) => {
    const urls = urlsFromArgv(argv);
    if (!ready) return pendingUrls.push(...urls);
    if (urls.length) urls.forEach((u) => manager.openUrl(u));
    else manager.createWindow({});
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (ready) manager.openUrl(url);
    else pendingUrls.push(url);
  });

  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });

  // HTTP basic/digest authentication (routers, intranet pages, …)
  app.on('login', (event, wc, details, authInfo, callback) => {
    const tab = wc && manager.findTab(wc);
    if (!tab) return;
    event.preventDefault();
    tab.win.requestAuth(tab, { host: authInfo.host, realm: authInfo.realm, proxy: authInfo.isProxy }, callback);
  });

  function configureDns() {
    const mode = settings.get('privacy.dns');
    const providers = {
      cloudflare: ['https://cloudflare-dns.com/dns-query'],
      quad9: ['https://dns.quad9.net/dns-query'],
      google: ['https://dns.google/dns-query{?dns}'],
    };
    try {
      if (mode === 'off') app.configureHostResolver({ secureDnsMode: 'off' });
      else if (mode === 'automatic') app.configureHostResolver({ secureDnsMode: 'automatic' });
      else {
        const custom = settings.get('privacy.dnsCustom');
        const servers = mode === 'custom' ? (/^https:\/\//.test(custom) ? [custom] : []) : providers[mode];
        if (servers && servers.length) app.configureHostResolver({ secureDnsMode: 'secure', secureDnsServers: servers });
        else app.configureHostResolver({ secureDnsMode: 'automatic' });
      }
    } catch (err) {
      console.warn('[dns] configure failed', err.message);
    }
  }

  function macMenu() {
    return Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]);
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null);
    nativeTheme.themeSource = settings.get('appearance.theme');

    history.open();
    bookmarks.load();
    downloads.load();
    permissions.load();

    const browsing = session.fromPartition('persist:imp');
    const net = session.fromPartition('imp-net');
    manager.init(browsing);
    manager.setupSession(browsing, false);
    shields.init(net, (wcId, url) => manager.findTabByWcId(wcId)?.noteBlocked(url));
    configureDns();
    internal.init(manager, updater);
    ipc.init(manager, net);

    settings.on('change', (key, value) => {
      manager.broadcast('state:settings', settings.data);
      manager.notifyPages('settings', settings.data);
      if (key === 'appearance.theme' || key === '*') nativeTheme.themeSource = settings.get('appearance.theme');
      if (key === 'appearance.theme' || key === 'appearance.verticalTabs' || key === '*') manager.refreshTheme();
      if (key.startsWith('privacy.dns') || key === '*') configureDns();
      if (key === 'appearance.language' || key === '*') manager.broadcast('state:lang', lang());
      if (key === 'shields.allowlist') for (const w of manager.windows) w.sendTabs();
    });
    nativeTheme.on('updated', () => {
      manager.refreshTheme();
      manager.broadcast('state:theme', nativeTheme.shouldUseDarkColors);
    });

    const urls = [...urlsFromArgv(process.argv), ...pendingUrls];
    const firstRun = !settings.get('meta.firstRunDone');
    if (firstRun) {
      manager.createWindow({ url: 'imp://welcome/' });
      urls.forEach((u) => manager.openUrl(u));
    } else if (settings.get('startup.mode') === 'restore' && manager.restoreSession()) {
      urls.forEach((u) => manager.openUrl(u));
    } else {
      manager.createWindow({ url: urls.shift() });
      urls.forEach((u) => manager.openUrl(u));
    }
    // Since 1.0.1 third-party cookies are allowed by default (they broke sign-ins);
    // move existing 1.0.0 installs to the new default once.
    if (settings.get('meta.lastVersion') === '1.0.0' && app.getVersion() !== '1.0.0') {
      settings.set('shields.thirdPartyCookies', false);
    }
    settings.set('meta.lastVersion', app.getVersion());
    ready = true;
    updater.init(manager);
  });

  app.on('activate', () => {
    if (ready && !manager.windows.size) manager.createWindow({});
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (!manager.quitting) {
      manager.saveSession();
      manager.quitting = true;
    }
    flushAll();
  });

  app.on('will-quit', (event) => {
    if (settings.get('privacy.clearOnExit') && !cleared && manager.browsing) {
      event.preventDefault();
      cleared = true;
      internal
        .clearData({ history: true, cookies: true, cache: true })
        .catch(() => {})
        .finally(() => app.quit());
      return;
    }
    flushAll();
    history.close();
  });
}
