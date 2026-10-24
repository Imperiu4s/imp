'use strict';
// Loading predictor: learns which other servers each site loads from (CDNs,
// fonts, APIs, …) and, the moment you head to that site again, opens
// connections to them before the page asks. The page then skips a DNS lookup
// and a TLS handshake (often 100–300 ms) for each of them.
const { JsonFile } = require('./store');
const settings = require('./settings');

const MAX_SITES = 500;
const MAX_ORIGINS = 16; // remembered per site
const PRECONNECT = 6; // opened per navigation
const MIN_SHARE = 0.3; // only servers used by at least this share of loads
const starts = new Map(); // webContents id -> host a navigation started with
const loads = new Map(); // webContents id -> { host, own, seen: Set<origin> } of the current page

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch {
    return '';
  }
}

class Predictor {
  get file() {
    this._file ||= new JsonFile('predictor.json', { sites: {}, redirects: {} });
    return this._file;
  }

  get sites() {
    return this.file.data.sites;
  }

  get redirects() {
    return (this.file.data.redirects ||= {});
  }

  // Learning only happens where history is kept, and never in private windows.
  learning(ses) {
    return settings.get('performance.preconnect') && settings.get('privacy.saveHistory') && ses.isPersistent();
  }

  // From the tab: a page load is starting. Connect to what that site will need.
  navigationStarted(wc, url) {
    if (!/^https?:/.test(url)) return starts.delete(wc.id);
    starts.set(wc.id, hostOf(url));
    this.prefetchDns(wc.session, url);
  }

  // From the tab: the new page has arrived (after any redirects).
  navigated(wc, url) {
    loads.delete(wc.id);
    const start = starts.get(wc.id);
    starts.delete(wc.id);
    const host = hostOf(url);
    if (!host || !/^https?:/.test(url) || !this.learning(wc.session)) return;
    // example.com sending you on to www.example.com: next time, prepare for www.
    const redirects = this.redirects;
    if (start && start !== host) redirects[start] = host;
    else if (start) delete redirects[start];
    loads.set(wc.id, { host, own: originOf(url), seen: new Set() });
    const site = (this.sites[host] ||= { loads: 0, origins: {}, used: 0 });
    site.loads++;
    site.used = Date.now();
    this.trim();
    if (!this.file.dirty) this.file.save(10_000);
  }

  // Every request that goes out (blocked ones never get here).
  observe(details, topUrl) {
    const load = details.resourceType !== 'mainFrame' && loads.get(details.webContentsId);
    if (!load || hostOf(topUrl) !== load.host) return;
    const origin = originOf(details.url);
    if (!origin || origin === load.own || load.seen.has(origin)) return;
    load.seen.add(origin);
    const site = this.sites[load.host];
    if (!site) return;
    site.origins[origin] = (site.origins[origin] || 0) + 1;
    // Fonts are fetched without cookies, over a connection of their own.
    if (details.resourceType === 'font' && !site.fonts?.includes(origin)) (site.fonts ||= []).push(origin);
    const entries = Object.entries(site.origins);
    if (entries.length > MAX_ORIGINS) {
      entries.sort((a, b) => b[1] - a[1]);
      site.origins = Object.fromEntries(entries.slice(0, MAX_ORIGINS));
    }
  }

  forget(wcId) {
    starts.delete(wcId);
    loads.delete(wcId);
  }

  // The servers this site usually needs, most used first.
  likely(host, limit = PRECONNECT) {
    const site = this.sites[host];
    if (!site || site.loads < 2) return [];
    return Object.entries(site.origins)
      .filter(([, n]) => n / site.loads >= MIN_SHARE)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([origin]) => origin);
  }

  // Look up their addresses in advance (DNS only: connections opened from here
  // could not be used by the page's requests, see linkHints). A site known to
  // send you elsewhere gets a connection to where you'll end up.
  prefetchDns(ses, url, limit = PRECONNECT) {
    if (!settings.get('performance.preconnect') || !ses.isPersistent()) return;
    let host = hostOf(url);
    const target = this.redirects[host];
    if (target) {
      host = target;
      try {
        ses.preconnect({ url: `https://${target}`, numSockets: 1 });
      } catch {}
    }
    for (const origin of this.likely(host, limit)) ses.resolveHost(hostOf(origin)).catch(() => {});
  }

  // The same servers as Link: rel=preconnect hints, added to the page's own
  // response. Chromium keeps each site's connections apart (so one site can't
  // track you through another's), so the connections have to be opened on the
  // page's behalf, which is exactly what these hints do.
  linkHints(details) {
    const ses = details.webContents?.session;
    if (!ses || !settings.get('performance.preconnect') || !ses.isPersistent()) return [];
    const site = this.sites[hostOf(details.url)];
    return this.likely(hostOf(details.url)).map((origin) => `<${origin}>; rel=preconnect${site.fonts?.includes(origin) ? '; crossorigin' : ''}`);
  }

  trim() {
    const hosts = Object.keys(this.sites);
    if (hosts.length <= MAX_SITES) return;
    hosts.sort((a, b) => this.sites[a].used - this.sites[b].used);
    for (const h of hosts.slice(0, hosts.length - MAX_SITES)) delete this.sites[h];
    const redirects = this.redirects;
    for (const [from, to] of Object.entries(redirects)) if (!this.sites[to]) delete redirects[from];
  }

  clear() {
    this.file.data.sites = {};
    this.file.data.redirects = {};
    this.file.save();
  }
}

module.exports = new Predictor();
