'use strict';
// Browsing history stored in SQLite (built into Node, no native module needed).
const { DatabaseSync } = require('node:sqlite');
const { dataPath } = require('./store');

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 120;

let db = null;
let q = {};

function open() {
  if (db) return;
  db = new DatabaseSync(dataPath('history.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      favicon TEXT NOT NULL DEFAULT '',
      visits INTEGER NOT NULL DEFAULT 0,
      typed INTEGER NOT NULL DEFAULT 0,
      last_visit INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY,
      url_id INTEGER NOT NULL,
      time INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
    CREATE INDEX IF NOT EXISTS visits_url ON visits(url_id);
    CREATE TABLE IF NOT EXISTS searches (
      query TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 1,
      last INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS searches_last ON searches(last);
  `);
  q = {
    getUrl: db.prepare('SELECT id, last_visit FROM urls WHERE url = ?'),
    insertUrl: db.prepare('INSERT INTO urls (url, title, visits, typed, last_visit) VALUES (?, ?, 1, ?, ?)'),
    bumpUrl: db.prepare('UPDATE urls SET visits = visits + 1, typed = typed + ?, last_visit = ?, title = CASE WHEN ? <> \'\' THEN ? ELSE title END WHERE id = ?'),
    touchUrl: db.prepare('UPDATE urls SET last_visit = ? WHERE id = ?'),
    insertVisit: db.prepare('INSERT INTO visits (url_id, time) VALUES (?, ?)'),
    setTitle: db.prepare('UPDATE urls SET title = ? WHERE url = ?'),
    setFavicon: db.prepare('UPDATE urls SET favicon = ? WHERE url = ?'),
    search: db.prepare(`SELECT url, title, favicon, visits, typed FROM urls
      WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
      ORDER BY (typed * 4 + visits) DESC, last_visit DESC LIMIT ?`),
    prefix: db.prepare(`SELECT url FROM urls
      WHERE url LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'
      ORDER BY (typed * 4 + visits) DESC, last_visit DESC LIMIT 8`),
    top: db.prepare('SELECT url, title, favicon, visits FROM urls WHERE last_visit > ? ORDER BY visits DESC LIMIT 80'),
    deleteVisit: db.prepare('DELETE FROM visits WHERE id = ?'),
    deleteUrl: db.prepare('DELETE FROM urls WHERE url = ?'),
    deleteVisitsOfUrl: db.prepare('DELETE FROM visits WHERE url_id = (SELECT id FROM urls WHERE url = ?)'),
    deleteSince: db.prepare('DELETE FROM visits WHERE time >= ?'),
    deleteBefore: db.prepare('DELETE FROM visits WHERE time < ?'),
    orphanUrls: db.prepare('DELETE FROM urls WHERE id NOT IN (SELECT DISTINCT url_id FROM visits)'),
    count: db.prepare('SELECT COUNT(*) AS n FROM visits'),
    getSearch: db.prepare('SELECT last FROM searches WHERE query = ?'),
    upsertSearch: db.prepare(`INSERT INTO searches (query, count, last) VALUES (?, 1, ?)
      ON CONFLICT(query) DO UPDATE SET count = count + 1, last = excluded.last`),
    touchSearch: db.prepare('UPDATE searches SET last = ? WHERE query = ?'),
    recentSearches: db.prepare('SELECT query FROM searches ORDER BY last DESC LIMIT ?'),
    matchSearches: db.prepare(`SELECT query FROM searches WHERE query LIKE ? ESCAPE '\\' AND query <> ?
      ORDER BY count DESC, last DESC LIMIT ?`),
    deleteSearch: db.prepare('DELETE FROM searches WHERE query = ?'),
    deleteSearchesSince: db.prepare('DELETE FROM searches WHERE last >= ?'),
    deleteSearchesBefore: db.prepare('DELETE FROM searches WHERE last < ?'),
  };
  // Old entries are pruned shortly after startup, not during it.
  setTimeout(() => {
    if (!db) return;
    try {
      q.deleteBefore.run(Date.now() - RETENTION_DAYS * DAY);
      q.deleteSearchesBefore.run(Date.now() - RETENTION_DAYS * DAY);
      q.orphanUrls.run();
    } catch (err) {
      console.error('[history] prune failed', err);
    }
  }, 20_000).unref?.();
}

function isRecordable(url) {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function addVisit(url, title = '', typed = false) {
  if (!db || !isRecordable(url)) return;
  const now = Date.now();
  const row = q.getUrl.get(url);
  if (row) {
    // A reload or a quick re-visit is not a new visit.
    if (now - row.last_visit < 30_000) {
      q.touchUrl.run(now, row.id);
      return;
    }
    q.bumpUrl.run(typed ? 1 : 0, now, title, title, row.id);
    q.insertVisit.run(row.id, now);
  } else {
    const res = q.insertUrl.run(url, title, typed ? 1 : 0, now);
    q.insertVisit.run(res.lastInsertRowid, now);
  }
}

function setTitle(url, title) {
  if (db && isRecordable(url) && title) q.setTitle.run(title, url);
}

function setFavicon(url, favicon) {
  if (db && isRecordable(url) && favicon && favicon.length < 2048) q.setFavicon.run(favicon, url);
}

const esc = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function search(text, limit = 6) {
  if (!db || !text) return [];
  const like = `%${esc(text)}%`;
  return q.search.all(like, like, limit);
}

// Inline autocompletion: "git" -> "github.com"
function autocomplete(text) {
  if (!db || !text || /\s/.test(text)) return null;
  const t = text.toLowerCase().replace(/^https?:\/\//, '');
  const e = esc(t);
  const rows = q.prefix.all(`https://${e}%`, `https://www.${e}%`, `http://${e}%`, `http://www.${e}%`);
  for (const { url } of rows) {
    const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (!bare.toLowerCase().startsWith(t)) continue;
    if (!t.includes('/')) {
      const host = bare.split('/')[0];
      if (host.toLowerCase().startsWith(t)) return { completion: host, url: url.replace(/^(https?:\/\/[^/]+).*/i, '$1/') };
    } else {
      return { completion: bare.replace(/\/$/, ''), url };
    }
  }
  return null;
}

function list({ query = '', before = Date.now() + 1, limit = 100 } = {}) {
  if (!db) return [];
  const like = `%${esc(query)}%`;
  const sql = `SELECT v.id, v.time, u.url, u.title, u.favicon FROM visits v JOIN urls u ON u.id = v.url_id
    WHERE v.time < ? ${query ? "AND (u.url LIKE ? ESCAPE '\\' OR u.title LIKE ? ESCAPE '\\')" : ''}
    ORDER BY v.time DESC LIMIT ?`;
  const stmt = db.prepare(sql);
  return query ? stmt.all(before, like, like, limit) : stmt.all(before, limit);
}

function topSites(n = 8) {
  if (!db) return [];
  const rows = q.top.all(Date.now() - 45 * DAY);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    let host;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

function deleteVisit(id) {
  if (!db) return;
  q.deleteVisit.run(id);
  q.orphanUrls.run();
}

function deleteUrl(url) {
  if (!db) return;
  q.deleteVisitsOfUrl.run(url);
  q.deleteUrl.run(url);
}

// range: hour | day | week | month | all
function clear(range = 'all') {
  if (!db) return;
  const spans = { hour: 3600e3, day: DAY, week: 7 * DAY, month: 30 * DAY };
  if (range === 'all' || !spans[range]) {
    db.exec('DELETE FROM visits; DELETE FROM urls; DELETE FROM searches;');
  } else {
    q.deleteSince.run(Date.now() - spans[range]);
    q.deleteSearchesSince.run(Date.now() - spans[range]);
    q.orphanUrls.run();
  }
}

// ---- searches typed into the address bar / search engine -------------------------

function addSearch(query) {
  const text = String(query || '').trim().slice(0, 300);
  if (!db || !text) return;
  const now = Date.now();
  const row = q.getSearch.get(text);
  // Paging through the same results is not a new search.
  if (row && now - row.last < 60_000) q.touchSearch.run(now, text);
  else q.upsertSearch.run(text, now);
}

function recentSearches(limit = 8) {
  return db ? q.recentSearches.all(limit).map((r) => r.query) : [];
}

function matchSearches(prefix, limit = 3) {
  const text = String(prefix || '').trim();
  if (!db || !text) return [];
  return q.matchSearches.all(`${esc(text)}%`, text, limit).map((r) => r.query);
}

function deleteSearch(query) {
  if (db) q.deleteSearch.run(String(query));
}

function close() {
  try {
    db?.close();
  } catch {}
  db = null;
}

module.exports = {
  open,
  close,
  addVisit,
  setTitle,
  setFavicon,
  search,
  autocomplete,
  list,
  topSites,
  deleteVisit,
  deleteUrl,
  clear,
  addSearch,
  recentSearches,
  matchSearches,
  deleteSearch,
};
