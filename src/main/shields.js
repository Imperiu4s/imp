'use strict';
// Imp Shields: ad & tracker blocking, HTTPS upgrades, third-party cookie
// blocking and Global Privacy Control — all in one webRequest pipeline
// (Electron only allows one listener per webRequest event).
const fs = require('node:fs');
const { ipcMain, webContents } = require('electron');
const { parse: parseHost, getDomain } = require('tldts');
const settings = require('./settings');
const compat = require('./compat');
const trace = require('./trace');
const { JsonFile, dataPath } = require('./store');

const PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');
const DAY = 24 * 60 * 60 * 1000;

let ghostery = null;
const lib = () => (ghostery ||= require('@ghostery/adblocker-electron'));
const LOCAL_SUFFIXES = ['.local', '.lan', '.internal', '.test', '.localhost', '.home.arpa', '.intranet', '.corp'];

const stats = new JsonFile('stats.json', { blocked: 0, upgraded: 0, since: Date.now() });

let engine = null;
let loading = null;
let netSession = null;
let retryTimer = null;
let onBlocked = () => {};
const httpAllowed = new Set();
const upgrades = new Map(); // webContentsId -> { host, httpUrl, time }

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function siteKey(host) {
  return (host || '').replace(/^www\./, '').toLowerCase();
}

function isAllowlisted(host) {
  const key = siteKey(host);
  return !!key && settings.get('shields.allowlist').includes(key);
}

function setSiteEnabled(host, enabled) {
  const key = siteKey(host);
  if (!key) return;
  const list = settings.get('shields.allowlist').filter((h) => h !== key);
  if (!enabled) list.push(key);
  settings.set('shields.allowlist', list);
}

// ---- filter engine ---------------------------------------------------------

let engineMode = null;
let engineAge = Infinity;

// Loads the ad-block library and the cached filter engine synchronously. Runs
// before the first window is created, so no page request goes unfiltered.
function preloadEngine() {
  const mode = settings.get('shields.adblock');
  if (mode === 'off') return;
  const file = dataPath(`shields-${mode}.bin`);
  try {
    const buf = fs.readFileSync(file);
    engineAge = Date.now() - fs.statSync(file).mtimeMs;
    engine = lib().ElectronBlocker.deserialize(new Uint8Array(buf));
    engineMode = mode;
    trace.mark('ad-block engine loaded from cache');
  } catch {
    engineAge = Infinity;
  }
}

async function loadEngine() {
  const mode = settings.get('shields.adblock');
  clearTimeout(retryTimer);
  if (mode === 'off') {
    engine = null;
    engineMode = null;
    return;
  }
  if (engineMode !== mode) preloadEngine();
  if (engine && engineMode === mode && engineAge < 3 * DAY) return;
  try {
    const fetchImpl = (url) => netSession.fetch(url, { cache: 'no-store' });
    const fresh =
      mode === 'aggressive'
        ? await lib().ElectronBlocker.fromPrebuiltFull(fetchImpl)
        : await lib().ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl);
    if (settings.get('shields.adblock') !== mode) return;
    engine = fresh;
    engineMode = mode;
    engineAge = 0;
    fs.writeFileSync(dataPath(`shields-${mode}.bin`), Buffer.from(fresh.serialize()));
  } catch (err) {
    console.warn('[shields] filter list update failed:', err.message);
    if (!engine) retryTimer = setTimeout(reloadEngine, 60_000);
  }
}

function reloadEngine() {
  loading = loadEngine().finally(() => (loading = null));
  return loading;
}

// ---- helpers ------------------------------------------------------------------

function topUrlFor(details) {
  let wc = details.webContents;
  if (!wc && details.webContentsId) wc = webContents.fromId(details.webContentsId);
  if (!wc || wc.isDestroyed()) return '';
  return wc.getURL();
}

function isThirdParty(url, topUrl) {
  const a = getDomain(hostOf(topUrl));
  const b = getDomain(hostOf(url));
  return !!a && !!b && a !== b;
}

function isUpgradable(host) {
  if (!host || !host.includes('.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) return false;
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  const p = parseHost(host);
  return !!(p.isIcann || p.isPrivate);
}

function record(details) {
  stats.data.blocked++;
  stats.save(5000);
  onBlocked(details.webContentsId, details.url);
}

// ---- webRequest pipeline -------------------------------------------------------

function maybeUpgrade(details) {
  const mode = settings.get('shields.https');
  const { url } = details;
  if (mode === 'off' || !url.startsWith('http://')) return null;
  const host = hostOf(url);
  if (!isUpgradable(host) || httpAllowed.has(host) || isAllowlisted(host)) return null;
  const prev = upgrades.get(details.webContentsId);
  if (prev && prev.host === host && Date.now() - prev.time < 5000) {
    // The HTTPS site redirected us back to HTTP: it doesn't support HTTPS.
    httpAllowed.add(host);
    return null;
  }
  upgrades.set(details.webContentsId, { host, httpUrl: url, time: Date.now() });
  stats.data.upgraded++;
  stats.save(5000);
  return `https://${url.slice(7)}`;
}

function onBeforeRequest(details, callback) {
  const { url, resourceType } = details;
  if (resourceType === 'mainFrame') {
    const redirectURL = maybeUpgrade(details);
    return callback(redirectURL ? { redirectURL } : {});
  }
  if (!engine || !/^(https?|wss?):/i.test(url)) return callback({});
  const topUrl = topUrlFor(details);
  if (!/^https?:/i.test(topUrl) || isAllowlisted(hostOf(topUrl))) return callback({});
  let sourceUrl = topUrl;
  try {
    if (details.frame && details.frame.url) sourceUrl = details.frame.url;
  } catch {}
  const request = lib().Request.fromRawDetails({
    requestId: String(details.id),
    tabId: details.webContentsId,
    type: resourceType || 'other',
    url,
    sourceUrl,
  });
  if (request.type === 'other') request.guessTypeOfRequest();
  const { match, redirect } = engine.match(request);
  if (redirect) {
    record(details);
    return callback({ redirectURL: redirect.dataUrl });
  }
  if (match) {
    record(details);
    return callback({ cancel: true });
  }
  callback({});
}

function onBeforeSendHeaders(details, callback) {
  const headers = details.requestHeaders;
  if (settings.get('shields.gpc')) headers['Sec-GPC'] = '1';
  const topUrl = details.resourceType === 'mainFrame' ? details.url : topUrlFor(details);
  if (compat.isGoogleAuthHost(hostOf(details.url)) || compat.isGoogleAuthHost(hostOf(topUrl))) {
    compat.applyGoogleAuthHeaders(headers);
  }
  if (settings.get('shields.thirdPartyCookies') && details.resourceType !== 'mainFrame') {
    if (isThirdParty(details.url, topUrl) && !isAllowlisted(hostOf(topUrl))) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
    }
  }
  callback({ requestHeaders: headers });
}

function onHeadersReceived(details, callback) {
  const headers = details.responseHeaders || {};
  let changed = false;
  const isFrame = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
  const topUrl = details.resourceType === 'mainFrame' ? details.url : topUrlFor(details);
  const allowlisted = isAllowlisted(hostOf(topUrl));

  if (engine && isFrame && !allowlisted) {
    const csp = engine.getCSPDirectives(
      lib().Request.fromRawDetails({ url: details.url, type: details.resourceType, sourceUrl: topUrl }),
    );
    if (csp) {
      const policies = csp.split(';').map((s) => s.trim());
      for (const [name, values] of Object.entries(headers)) {
        if (name.toLowerCase() === 'content-security-policy') {
          policies.push(...values);
          delete headers[name];
        }
      }
      headers['content-security-policy'] = [policies.join(';')];
      changed = true;
    }
  }

  if (settings.get('shields.thirdPartyCookies') && details.resourceType !== 'mainFrame' && !allowlisted) {
    if (isThirdParty(details.url, topUrl)) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'set-cookie') {
          delete headers[k];
          changed = true;
        }
      }
    }
  }
  callback(changed ? { responseHeaders: headers } : {});
}

// ---- public API ---------------------------------------------------------------

function init(net, blockedCallback) {
  netSession = net;
  onBlocked = blockedCallback;
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    if (!engine) return;
    if (isAllowlisted(hostOf(event.sender.getURL()))) return;
    return engine.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => !!engine?.config.enableMutationObserver);
  settings.on('change', (key) => {
    if (key === 'shields.adblock' || key === '*') reloadEngine();
  });
  return reloadEngine();
}

function setupSession(ses) {
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH });
  const filter = { urls: ['<all_urls>'] };
  ses.webRequest.onBeforeRequest(filter, onBeforeRequest);
  ses.webRequest.onBeforeSendHeaders(filter, onBeforeSendHeaders);
  ses.webRequest.onHeadersReceived(filter, onHeadersReceived);
}

// Called by a tab when a main-frame load fails. Returns the plain-HTTP URL to
// fall back to when the failure was caused by our HTTPS upgrade.
const HTTPS_FAILURES = new Set([-100, -101, -102, -107, -109, -113, -118, -200, -201, -202, -203, -207, -210, -213]);
function httpsFallback(webContentsId, failedUrl, errorCode) {
  const up = upgrades.get(webContentsId);
  if (!up || hostOf(failedUrl) !== up.host || !failedUrl.startsWith('https://')) return null;
  if (!HTTPS_FAILURES.has(errorCode) && !(errorCode <= -200 && errorCode > -300)) return null;
  upgrades.delete(webContentsId);
  return { httpUrl: `http://${failedUrl.slice(8)}`, host: up.host, strict: settings.get('shields.https') === 'strict' };
}

function allowHttp(host) {
  httpAllowed.add(host);
}

function forget(webContentsId) {
  upgrades.delete(webContentsId);
}

function getStats() {
  return { ...stats.data, engineReady: !!engine, mode: settings.get('shields.adblock') };
}

function resetStats() {
  stats.data = { blocked: 0, upgraded: 0, since: Date.now() };
  stats.save();
}

module.exports = {
  init,
  setupSession,
  isAllowlisted,
  setSiteEnabled,
  siteKey,
  httpsFallback,
  allowHttp,
  forget,
  getStats,
  resetStats,
  hostOf,
};
