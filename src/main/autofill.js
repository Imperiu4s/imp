'use strict';
// The password manager inside web pages: offering to save a sign-in, and the
// list of saved accounts under a login field. The page side lives in
// src/preload/page.js; a page only ever receives a password after you pick
// the account from the list (drawn by the browser, outside the page).
const { ipcMain } = require('electron');
const settings = require('./settings');
const passwords = require('./passwords');

const PENDING_MS = 2 * 60 * 1000; // a sign-in counts this long after the form is sent
const OFFER_MS = 15 * 1000; // the key icon survives redirects for this long
let manager = null;

// The tab and page origin a preload message came from (main frame of an http(s) page only).
function source(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return null;
  const tab = manager.findTab(event.sender);
  if (!tab) return null;
  let origin = '';
  try {
    const u = new URL(frame.url);
    if (/^https?:$/.test(u.protocol)) origin = u.origin;
  } catch {}
  return origin ? { tab, origin } : null;
}

const str = (v, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '');

function sameSite(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '');
    const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
  } catch {
    return false;
  }
}

// ---- saving -----------------------------------------------------------------------------

function offer(tab) {
  const p = tab.passwordPending;
  tab.passwordPending = null;
  if (!p || Date.now() - p.time > PENDING_MS) return;
  if (tab.isPrivate || !settings.get('passwords.offer') || passwords.isNever(p.origin)) return;
  const existing = passwords.find(p.origin, p.username);
  if (existing && passwords.reveal(existing.id) === p.password) {
    passwords.markUsed(existing.id);
    return;
  }
  tab.passwordOffer = { origin: p.origin, username: p.username, password: p.password, update: !!existing, time: Date.now() };
  const w = tab.win;
  w.sendTabs();
  if (w.activeId === tab.id && !w.win.isDestroyed()) w.send('ui:password-offer');
}

function offerData(tab) {
  const o = tab?.passwordOffer;
  if (!o) return null;
  return { host: o.origin.replace(/^https?:\/\//, ''), username: o.username, password: o.password, update: o.update };
}

function save(tab, { username, password } = {}) {
  const o = tab?.passwordOffer;
  if (!o) return;
  tab.passwordOffer = null;
  passwords.save({ origin: o.origin, username: typeof username === 'string' ? username : o.username, password: password || o.password });
  tab.changed();
}

function never(tab) {
  const o = tab?.passwordOffer;
  if (!o) return;
  tab.passwordOffer = null;
  passwords.addNever(o.origin);
  tab.changed();
}

// Called on every main-frame navigation of a tab.
function onNavigate(tab) {
  hideList(tab.win, tab);
  if (tab.passwordPending) offer(tab);
  else if (tab.passwordOffer && Date.now() - tab.passwordOffer.time > OFFER_MS) {
    tab.passwordOffer = null;
    if (tab.win.popup?.type === 'pwsave' && tab.win.activeId === tab.id) tab.win.closePopup('pwsave', true);
  }
}

// ---- the list of saved accounts under a field -------------------------------------------

function listItems(origin, field, value) {
  let items = passwords.forOrigin(origin);
  const typed = field === 'username' ? value.trim().toLowerCase() : '';
  if (typed) items = items.filter((l) => l.username.toLowerCase().startsWith(typed));
  return items.slice(0, 8).map((l) => ({ id: l.id, username: l.username, host: l.exact ? '' : l.host }));
}

function showList(tab, origin, { field, rect, value }) {
  const w = tab.win;
  if (!settings.get('passwords.autofill') || !tab.view || !w.isVisible(tab) || w.activeId !== tab.id) return;
  if (Date.now() < (tab.pwQuietUntil || 0)) return;
  const items = listItems(origin, field, value);
  if (!items.length) return hideList(w, tab);
  const zoom = tab.wc.getZoomFactor();
  const b = tab.view.getBounds();
  const anchor = {
    x: b.x + rect.x * zoom,
    y: b.y + rect.y * zoom,
    width: rect.width * zoom,
    height: rect.height * zoom,
    align: 'left',
    gap: 2,
  };
  if (anchor.y + anchor.height < b.y || anchor.y > b.y + b.height) return;
  const data = { items, selected: -1, width: Math.max(260, Math.min(420, anchor.width)) };
  if (w.popup && w.popup.type !== 'pwfill') return;
  clearTimeout(w.pwBlurTimer);
  w.pwList = { tabId: tab.id, origin, field, ...data };
  w.openPopup('pwfill', anchor, data);
  tab.wc.send('imp:pw-popup', { open: true, selected: false });
}

function hideList(w, tab) {
  if (!w.pwList || (tab && w.pwList.tabId !== tab.id)) return;
  if (w.popup?.type === 'pwfill') w.closePopup('pwfill', true);
  else listClosed(w);
}

// The window closed the list (any reason): tell the page.
function listClosed(w) {
  const list = w.pwList;
  w.pwList = null;
  clearTimeout(w.pwBlurTimer);
  const tab = list && w.getTab(list.tabId);
  if (tab?.wc) tab.wc.send('imp:pw-popup', { open: false });
}

function fill(w, index) {
  const list = w.pwList;
  const tab = list && w.getTab(list.tabId);
  const item = list?.items[index];
  if (!tab?.wc || !item) return;
  const login = passwords.get(item.id);
  const password = login && passwords.reveal(item.id);
  hideList(w, tab);
  if (password == null) return;
  // Taking the focus back from the list re-focuses the field: don't reopen the list for that.
  tab.pwQuietUntil = Date.now() + 800;
  tab.pwLastFill = { id: item.id, origin: list.origin, time: Date.now() };
  passwords.markUsed(item.id);
  tab.wc.focus();
  tab.wc.send('imp:pw-fill', { username: login.username, password, field: list.field });
}

function moveSelection(w, step) {
  const list = w.pwList;
  if (!list || w.popup?.type !== 'pwfill') return;
  const n = list.items.length;
  list.selected = list.selected < 0 ? (step > 0 ? 0 : n - 1) : (list.selected + step + n) % n;
  w.updatePopup('pwfill', { items: list.items, selected: list.selected, width: list.width });
  w.getTab(list.tabId)?.wc?.send('imp:pw-popup', { open: true, selected: true });
}

// ---- wiring -----------------------------------------------------------------------------

function init(windowManager) {
  manager = windowManager;

  // Does this site have saved logins? Asked once a page shows a login field.
  ipcMain.handle('imp:pw-has', (event) => {
    const src = source(event);
    return !!src && settings.get('passwords.autofill') && passwords.forOrigin(src.origin).length > 0;
  });

  // First step of a two-step sign-in (e-mail now, password on the next screen).
  ipcMain.on('imp:pw-username', (event, username) => {
    const src = source(event);
    const name = str(username, 300).trim();
    if (src && name) src.tab.pwUsername = { origin: src.origin, username: name, time: Date.now() };
  });

  // A sign-in form was sent. Offered for saving once the page moves on.
  ipcMain.on('imp:pw-submit', (event, data) => {
    const src = source(event);
    const password = str(data?.password);
    if (!src || !password || src.tab.isPrivate || !settings.get('passwords.offer')) return;
    let username = str(data?.username, 300).trim();
    const prev = src.tab.pwUsername;
    if (!username && prev && Date.now() - prev.time < PENDING_MS && sameSite(prev.origin, src.origin)) username = prev.username;
    src.tab.passwordPending = { origin: src.origin, username, password, time: Date.now() };
  });

  // The login form disappeared without a page load (single-page apps).
  ipcMain.on('imp:pw-gone', (event) => {
    const src = source(event);
    if (src?.tab.passwordPending) offer(src.tab);
  });

  ipcMain.on('imp:pw-focus', (event, data) => {
    const src = source(event);
    const r = data?.rect;
    if (!src || !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return;
    const field = data.field === 'password' ? 'password' : 'username';
    showList(src.tab, src.origin, { field, rect: r, value: str(data.value, 300) });
  });

  ipcMain.on('imp:pw-input', (event, value) => {
    const src = source(event);
    const w = src?.tab.win;
    const list = w?.pwList;
    if (!list || list.tabId !== src.tab.id) return;
    const items = listItems(src.origin, list.field, str(value, 300));
    if (!items.length) return hideList(w, src.tab);
    Object.assign(list, { items, selected: -1 });
    w.updatePopup('pwfill', { items, selected: -1, width: list.width });
  });

  // The field lost focus. Wait a moment: a click on the list blurs it too.
  ipcMain.on('imp:pw-blur', (event) => {
    const src = source(event);
    const w = src?.tab.win;
    if (!w?.pwList) return;
    clearTimeout(w.pwBlurTimer);
    w.pwBlurTimer = setTimeout(() => hideList(w, src.tab), 180);
  });

  ipcMain.on('imp:pw-key', (event, key) => {
    const src = source(event);
    const w = src?.tab.win;
    if (!w?.pwList || w.pwList.tabId !== src.tab.id) return;
    if (key === 'ArrowDown') moveSelection(w, 1);
    else if (key === 'ArrowUp') moveSelection(w, -1);
    else if (key === 'Enter' && w.pwList.selected >= 0) fill(w, w.pwList.selected);
    else if (key === 'Escape') hideList(w, src.tab);
  });

  // Second screen of a two-step sign-in, right after an account was picked on
  // the first: the page may have the password of that same account.
  ipcMain.on('imp:pw-refill', (event) => {
    const src = source(event);
    const last = src?.tab.pwLastFill;
    if (!last || Date.now() - last.time > PENDING_MS || !sameSite(last.origin, src.origin)) return;
    const login = passwords.get(last.id);
    const password = login && passwords.reveal(last.id);
    if (password == null) return;
    src.tab.pwLastFill = null;
    src.tab.wc.send('imp:pw-fill', { username: login.username, password, field: 'password', passwordOnly: true });
  });

  // Saved logins changed: pages re-check whether they have any.
  passwords.on('change', () => {
    for (const tab of manager.allTabs()) tab.wc?.send('imp:pw-changed');
    manager.notifyPages('passwords');
  });
}

module.exports = { init, offerData, save, never, onNavigate, fill, listClosed, hideList };
