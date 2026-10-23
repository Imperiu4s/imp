'use strict';
// Address bar logic: turning input into URLs and building suggestions.
const { pathToFileURL } = require('node:url');
const { parse: parseHost } = require('tldts');
const ENGINES = require('../shared/engines');
const settings = require('./settings');
const history = require('./history');
const bookmarks = require('./bookmarks');

const SCHEME_RE = /^(https?|file|imp|chrome|about|view-source|data|blob|ftp|mailto):/i;
const LOCAL_TLDS = ['localhost', 'local', 'lan', 'internal', 'test', 'home', 'intranet', 'corp', 'arpa'];

function engine() {
  return ENGINES[settings.get('search.engine')] || ENGINES.duckduckgo;
}

function searchUrl(text) {
  return engine().search.replace('%s', encodeURIComponent(text));
}

function looksLikeHost(host) {
  if (/^localhost$/i.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return true;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return false;
  if (!/^[\p{L}\p{N}.-]+$/u.test(host)) return false;
  const tld = host.split('.').pop().toLowerCase();
  if (LOCAL_TLDS.includes(tld)) return true;
  const p = parseHost(host);
  return !!(p.isIcann || p.isPrivate);
}

// Returns { url, isSearch }
function resolve(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (SCHEME_RE.test(text) && !/^(https?|ftp):\/?$/i.test(text)) {
    if (/^javascript:/i.test(text)) return { url: searchUrl(text), isSearch: true };
    return { url: text, isSearch: false };
  }
  if (/^[a-zA-Z]:[\\/]/.test(text) || (text.startsWith('/') && process.platform !== 'win32') || text.startsWith('\\\\')) {
    return { url: pathToFileURL(text).href, isSearch: false };
  }
  if (/\s/.test(text) || text.startsWith('?')) return { url: searchUrl(text.replace(/^\?/, '')), isSearch: true };
  const m = text.match(/^([^/?#:]+|\[[^\]]+\])(:\d{1,5})?([/?#].*)?$/);
  if (m && looksLikeHost(m[1])) {
    const host = m[1].toLowerCase();
    const tld = host.split('.').pop();
    const plain = host === 'localhost' || /^\d/.test(host) || host.startsWith('[') || LOCAL_TLDS.includes(tld);
    return { url: `${plain ? 'http' : 'https'}://${text}`, isSearch: false };
  }
  return { url: searchUrl(text), isSearch: true };
}

function localSuggestions(text) {
  const out = [];
  const seen = new Set();
  const lower = text.toLowerCase();
  for (const b of bookmarks.list()) {
    if (b.type !== 'bookmark') continue;
    if (b.title.toLowerCase().includes(lower) || b.url.toLowerCase().includes(lower)) {
      out.push({ type: 'bookmark', title: b.title, url: b.url });
      seen.add(b.url);
      if (out.length >= 3) break;
    }
  }
  for (const h of history.search(text, 8)) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    out.push({ type: 'history', title: h.title, url: h.url, favicon: h.favicon });
    if (out.length >= 6) break;
  }
  return out;
}

function suggest(text, { isPrivate } = {}) {
  const resolved = resolve(text);
  const auto = isPrivate ? null : history.autocomplete(text);
  return {
    resolved,
    autocomplete: auto,
    items: isPrivate ? [] : localSuggestions(text),
    engine: engine().name,
  };
}

async function remoteSuggestions(text, net) {
  const e = engine();
  if (!e.suggest || !settings.get('search.suggestions') || !text.trim()) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await net.fetch(e.suggest.replace('%s', encodeURIComponent(text)), {
      signal: ctrl.signal,
      credentials: 'omit',
    });
    const data = await res.json();
    const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return list
      .map((s) => (typeof s === 'string' ? s : s?.phrase || s?.q || ''))
      .filter((s) => s && s.toLowerCase() !== text.toLowerCase())
      .slice(0, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolve, suggest, remoteSuggestions, searchUrl, engine };
