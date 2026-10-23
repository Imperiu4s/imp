'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JsonFile } = require('./store');

// item: { id, type: 'bookmark' | 'folder', title, url?, parent: 'bar' | 'other' | <folder id>, created }
class Bookmarks extends EventEmitter {
  load() {
    this.file = new JsonFile('bookmarks.json', { nextId: 1, items: [] });
  }

  get items() {
    return this.file.data.items;
  }

  changed() {
    this.file.save();
    this.emit('change');
  }

  list() {
    return this.items;
  }

  find(id) {
    return this.items.find((i) => i.id === id);
  }

  findByUrl(url) {
    return this.items.find((i) => i.type === 'bookmark' && i.url === url);
  }

  add({ title, url, parent = 'bar', type = 'bookmark', favicon }, silent = false) {
    const item = { id: this.file.data.nextId++, type, title: String(title || url || '').slice(0, 500), parent, created: Date.now() };
    if (type === 'bookmark') item.url = String(url);
    if (type === 'bookmark' && /^https?:\/\//.test(favicon || '') && favicon.length < 2048) item.favicon = favicon;
    this.items.push(item);
    if (!silent) this.changed();
    return item;
  }

  update(id, patch) {
    const item = this.find(id);
    if (!item) return;
    if (typeof patch.title === 'string') item.title = patch.title.slice(0, 500);
    if (typeof patch.url === 'string' && item.type === 'bookmark') item.url = patch.url;
    if (patch.parent !== undefined && patch.parent !== id) item.parent = patch.parent;
    this.changed();
  }

  move(id, parent, beforeId) {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const [item] = this.items.splice(idx, 1);
    item.parent = parent;
    const target = beforeId != null ? this.items.findIndex((i) => i.id === beforeId) : -1;
    if (target >= 0) this.items.splice(target, 0, item);
    else this.items.push(item);
    this.changed();
  }

  remove(id) {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of this.items) {
        if (!doomed.has(i.id) && doomed.has(i.parent)) {
          doomed.add(i.id);
          grew = true;
        }
      }
    }
    this.file.data.items = this.items.filter((i) => !doomed.has(i.id));
    this.changed();
  }

  toggle(url, title) {
    const existing = this.findByUrl(url);
    if (existing) {
      this.remove(existing.id);
      return null;
    }
    return this.add({ url, title });
  }

  // ---- import ----------------------------------------------------------------

  static browserSources() {
    const home = os.homedir();
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const mac = path.join(home, 'Library', 'Application Support');
    const linux = path.join(home, '.config');
    const table = {
      win32: {
        chrome: path.join(local, 'Google/Chrome/User Data/Default/Bookmarks'),
        edge: path.join(local, 'Microsoft/Edge/User Data/Default/Bookmarks'),
        brave: path.join(local, 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks'),
        vivaldi: path.join(local, 'Vivaldi/User Data/Default/Bookmarks'),
        opera: path.join(roaming, 'Opera Software/Opera Stable/Default/Bookmarks'),
        operaLegacy: path.join(roaming, 'Opera Software/Opera Stable/Bookmarks'),
      },
      darwin: {
        chrome: path.join(mac, 'Google/Chrome/Default/Bookmarks'),
        edge: path.join(mac, 'Microsoft Edge/Default/Bookmarks'),
        brave: path.join(mac, 'BraveSoftware/Brave-Browser/Default/Bookmarks'),
        vivaldi: path.join(mac, 'Vivaldi/Default/Bookmarks'),
        opera: path.join(mac, 'com.operasoftware.Opera/Bookmarks'),
      },
      linux: {
        chrome: path.join(linux, 'google-chrome/Default/Bookmarks'),
        edge: path.join(linux, 'microsoft-edge/Default/Bookmarks'),
        brave: path.join(linux, 'BraveSoftware/Brave-Browser/Default/Bookmarks'),
        vivaldi: path.join(linux, 'vivaldi/Default/Bookmarks'),
        opera: path.join(linux, 'opera/Bookmarks'),
      },
    }[process.platform] || {};
    const found = {};
    for (const [key, file] of Object.entries(table)) {
      const name = key === 'operaLegacy' ? 'opera' : key;
      if (!found[name] && fs.existsSync(file)) found[name] = file;
    }
    return found;
  }

  availableImports() {
    return Object.keys(Bookmarks.browserSources());
  }

  importFromBrowser(name) {
    const file = Bookmarks.browserSources()[name];
    if (!file) throw new Error('Browser not found');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const existing = new Set(this.items.filter((i) => i.type === 'bookmark').map((i) => i.url));
    let count = 0;
    const walk = (node, parent) => {
      for (const child of node.children || []) {
        if (child.type === 'url') {
          if (existing.has(child.url)) continue;
          existing.add(child.url);
          this.add({ title: child.name, url: child.url, parent }, true);
          count++;
        } else if (child.type === 'folder') {
          const folder = this.add({ type: 'folder', title: child.name, parent }, true);
          walk(child, folder.id);
        }
      }
    };
    if (json.roots?.bookmark_bar) walk(json.roots.bookmark_bar, 'bar');
    if (json.roots?.other) walk(json.roots.other, 'other');
    if (json.roots?.synced) walk(json.roots.synced, 'other');
    this.changed();
    return count;
  }

  // Netscape bookmark file (exported by Firefox, Safari, Chrome …)
  importHtml(file) {
    const html = fs.readFileSync(file, 'utf8');
    const decode = (s) =>
      s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const stack = ['other'];
    let pendingFolder = null;
    let count = 0;
    const re = /<DT><H3[^>]*>([\s\S]*?)<\/H3>|<DT><A\s+[^>]*HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<DL>|<\/DL>/gi;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[0].toUpperCase();
      if (m[1] !== undefined) {
        pendingFolder = this.add({ type: 'folder', title: decode(m[1]), parent: stack[stack.length - 1] }, true).id;
      } else if (m[2] !== undefined) {
        if (!/^(https?|ftp|file):/i.test(m[2])) continue;
        this.add({ title: decode(m[3]), url: decode(m[2]), parent: stack[stack.length - 1] }, true);
        count++;
      } else if (tag === '<DL>') {
        stack.push(pendingFolder ?? stack[stack.length - 1]);
        pendingFolder = null;
      } else if (tag === '</DL>' && stack.length > 1) {
        stack.pop();
      }
    }
    this.changed();
    return count;
  }

  exportHtml(file) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const children = (parent) => this.items.filter((i) => i.parent === parent);
    const render = (parent, indent) => {
      let out = `${indent}<DL><p>\n`;
      for (const i of children(parent)) {
        if (i.type === 'folder') out += `${indent}  <DT><H3>${esc(i.title)}</H3>\n${render(i.id, `${indent}  `)}`;
        else out += `${indent}  <DT><A HREF="${esc(i.url)}" ADD_DATE="${Math.floor(i.created / 1000)}">${esc(i.title)}</A>\n`;
      }
      return `${out}${indent}</DL><p>\n`;
    };
    const body = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
${render('bar', '  ')}  <DT><H3>Other bookmarks</H3>
${render('other', '  ')}</DL><p>
`;
    fs.writeFileSync(file, body);
  }
}

module.exports = new Bookmarks();
