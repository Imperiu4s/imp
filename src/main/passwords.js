'use strict';
// Saved passwords. Kept in passwords.json; every password is encrypted with the
// operating system's key store (Windows DPAPI, macOS Keychain, Linux Secret
// Service), so the file is useless when copied to another account or computer.
const { EventEmitter } = require('node:events');
const { safeStorage } = require('electron');
const { getDomain } = require('tldts');
const { JsonFile } = require('./store');

function originOf(url) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch {
    return '';
  }
}

const hostOf = (origin) => origin.replace(/^https?:\/\//, '').replace(/^www\./, '');
const siteOf = (origin) => {
  const host = new URL(origin).hostname;
  return getDomain(host) || host;
};

// ---- CSV (the format Chrome, Edge, Brave, Firefox and most password managers export) ----

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const csvField = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

class Passwords extends EventEmitter {
  get file() {
    // Loaded on first use, so startup never waits for it.
    this._file ||= new JsonFile('passwords.json', { nextId: 1, logins: [], never: [] });
    return this._file;
  }

  get logins() {
    return this.file.data.logins;
  }

  encrypt(text) {
    if (safeStorage.isEncryptionAvailable()) return `v1:${safeStorage.encryptString(text).toString('base64')}`;
    return `p:${Buffer.from(text, 'utf8').toString('base64')}`;
  }

  decrypt(blob) {
    try {
      if (blob.startsWith('v1:')) return safeStorage.decryptString(Buffer.from(blob.slice(3), 'base64'));
      if (blob.startsWith('p:')) return Buffer.from(blob.slice(2), 'base64').toString('utf8');
    } catch {}
    return null;
  }

  changed() {
    this.file.save(300);
    this.emit('change');
  }

  // Without the passwords: safe to hand to any page of the browser.
  describe(l) {
    return { id: l.id, origin: l.origin, host: hostOf(l.origin), username: l.username, created: l.created, used: l.used || 0, uses: l.uses || 0 };
  }

  list() {
    return this.logins.map((l) => this.describe(l)).sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username));
  }

  count() {
    return this.logins.length;
  }

  get(id) {
    return this.logins.find((l) => l.id === id) || null;
  }

  // Logins for a page: the exact site first, then other parts of the same
  // site (www.example.com, login.example.com, …), most used first.
  forOrigin(origin) {
    if (!origin) return [];
    let site;
    try {
      site = siteOf(origin);
    } catch {
      return [];
    }
    const https = origin.startsWith('https:');
    const exact = [];
    const related = [];
    for (const l of this.logins) {
      if (l.origin === origin) exact.push(l);
      else if (https && l.origin.startsWith('https:') && siteOf(l.origin) === site) related.push(l);
    }
    const byUse = (a, b) => (b.used || 0) - (a.used || 0);
    return [...exact.sort(byUse), ...related.sort(byUse)].map((l) => ({ ...this.describe(l), exact: l.origin === origin }));
  }

  find(origin, username) {
    return this.logins.find((l) => l.origin === origin && l.username === username) || null;
  }

  reveal(id) {
    const l = this.get(id);
    return l ? this.decrypt(l.password) : null;
  }

  // Adds a login, or changes the password of the same account on the same site.
  save({ origin, url, username = '', password }) {
    origin = origin || originOf(url || '');
    if (!origin || typeof password !== 'string' || !password) return null;
    username = String(username).trim();
    const now = Date.now();
    let l = this.find(origin, username);
    if (l) {
      l.password = this.encrypt(password);
      l.changed = now;
    } else {
      l = { id: this.file.data.nextId++, origin, username, password: this.encrypt(password), created: now, changed: now, used: 0, uses: 0 };
      this.logins.push(l);
    }
    this.removeNever(origin);
    this.changed();
    return l.id;
  }

  update(id, { url, username, password } = {}) {
    const l = this.get(id);
    if (!l) return false;
    if (url !== undefined) {
      const origin = originOf(url);
      if (!origin) return false;
      l.origin = origin;
    }
    if (username !== undefined) l.username = String(username).trim();
    if (password) l.password = this.encrypt(String(password));
    l.changed = Date.now();
    // Editing can turn two entries into the same account: keep the edited one.
    this.file.data.logins = this.logins.filter((x) => x === l || x.origin !== l.origin || x.username !== l.username);
    this.changed();
    return true;
  }

  markUsed(id) {
    const l = this.get(id);
    if (!l) return;
    l.used = Date.now();
    l.uses = (l.uses || 0) + 1;
    this.file.save(2000);
  }

  remove(id) {
    const before = this.logins.length;
    this.file.data.logins = this.logins.filter((l) => l.id !== id);
    if (this.logins.length !== before) this.changed();
  }

  removeAll() {
    this.file.data.logins = [];
    this.changed();
  }

  // ---- sites where saving was declined with "Never" ----

  isNever(origin) {
    return this.file.data.never.includes(origin);
  }

  never() {
    return [...this.file.data.never].sort();
  }

  addNever(origin) {
    if (!origin || this.isNever(origin)) return;
    this.file.data.never.push(origin);
    this.changed();
  }

  removeNever(origin) {
    const list = this.file.data.never;
    if (!list.includes(origin)) return;
    this.file.data.never = list.filter((o) => o !== origin);
    this.changed();
  }

  // ---- import / export ----

  importCsv(text) {
    const rows = parseCsv(String(text).replace(/^﻿/, ''));
    if (rows.length < 2) return { added: 0, updated: 0 };
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const iUrl = col('url', 'login_uri', 'website', 'web site', 'origin', 'login url', 'hostname');
    const iUser = col('username', 'login_username', 'login', 'user', 'user name', 'email', 'login name');
    const iPass = col('password', 'login_password');
    if (iUrl < 0 || iPass < 0) throw new Error('Unknown CSV format');
    let added = 0;
    let updated = 0;
    const now = Date.now();
    for (const r of rows.slice(1)) {
      const origin = originOf((r[iUrl] || '').trim());
      const password = r[iPass] || '';
      if (!origin || !password) continue;
      const username = iUser >= 0 ? (r[iUser] || '').trim() : '';
      const existing = this.find(origin, username);
      if (existing) {
        if (this.decrypt(existing.password) === password) continue;
        existing.password = this.encrypt(password);
        existing.changed = now;
        updated++;
      } else {
        this.logins.push({ id: this.file.data.nextId++, origin, username, password: this.encrypt(password), created: now, changed: now, used: 0, uses: 0 });
        added++;
      }
    }
    if (added || updated) this.changed();
    return { added, updated };
  }

  exportCsv() {
    const lines = ['name,url,username,password,note'];
    for (const l of this.logins) {
      const password = this.decrypt(l.password);
      if (password == null) continue;
      lines.push([hostOf(l.origin), `${l.origin}/`, l.username, password, ''].map(csvField).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}

module.exports = new Passwords();
module.exports.originOf = originOf;
