'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app, shell } = require('electron');
const settings = require('./settings');
const { JsonFile } = require('./store');

const MAX_HISTORY = 300;

function uniquePath(dir, filename) {
  const safe = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; fs.existsSync(candidate) || fs.existsSync(`${candidate}.crdownload`); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

class Downloads extends EventEmitter {
  load() {
    this.file = new JsonFile('downloads.json', { items: [] });
    this.active = new Map();
    this.counter = 0;
    this.emitTimer = null;
  }

  dir() {
    const custom = settings.get('downloads.dir');
    return custom && fs.existsSync(custom) ? custom : app.getPath('downloads');
  }

  setupSession(ses, isPrivate) {
    ses.on('will-download', (event, item) => this.handle(item, isPrivate));
  }

  handle(item, isPrivate) {
    const id = `${Date.now().toString(36)}${(this.counter++).toString(36)}`;
    const dir = this.dir();
    if (settings.get('downloads.ask')) {
      item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) });
    } else {
      item.setSavePath(uniquePath(dir, item.getFilename()));
    }
    const info = {
      id,
      url: item.getURL(),
      filename: item.getFilename(),
      path: item.getSavePath(),
      mime: item.getMimeType(),
      state: 'progressing',
      paused: false,
      received: 0,
      total: item.getTotalBytes(),
      speed: 0,
      start: Date.now(),
      private: isPrivate,
    };
    let lastBytes = 0;
    let lastTime = Date.now();
    this.active.set(id, { item, info });

    item.on('updated', (event, state) => {
      const now = Date.now();
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes();
      info.state = state;
      info.paused = item.isPaused();
      info.path = item.getSavePath() || info.path;
      if (info.path) info.filename = path.basename(info.path);
      if (now - lastTime >= 500) {
        info.speed = Math.max(0, ((info.received - lastBytes) * 1000) / (now - lastTime));
        lastBytes = info.received;
        lastTime = now;
      }
      this.scheduleEmit();
    });

    item.once('done', (event, state) => {
      info.state = state;
      info.received = item.getReceivedBytes();
      info.path = item.getSavePath() || info.path;
      if (info.path) info.filename = path.basename(info.path);
      info.end = Date.now();
      info.speed = 0;
      this.active.delete(id);
      if (!isPrivate && info.path) {
        this.file.data.items.unshift(info);
        this.file.data.items.length = Math.min(this.file.data.items.length, MAX_HISTORY);
        this.file.save();
      }
      if (state === 'completed' && process.platform === 'darwin' && info.path) app.dock?.downloadFinished(info.path);
      this.emit('done', info);
      this.emitNow();
    });

    this.emit('started', info);
    this.emitNow();
  }

  scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => this.emitNow(), 250);
  }

  emitNow() {
    clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.emit('change');
  }

  list() {
    const active = [...this.active.values()].map((a) => a.info);
    const done = this.file.data.items.map((i) => ({ ...i, exists: i.state !== 'completed' || fs.existsSync(i.path) }));
    return [...active, ...done];
  }

  progress() {
    let received = 0;
    let total = 0;
    for (const { info } of this.active.values()) {
      received += info.received;
      total += info.total || 0;
    }
    return { count: this.active.size, fraction: total > 0 ? received / total : -1 };
  }

  find(id) {
    return this.active.get(id)?.info || this.file.data.items.find((i) => i.id === id);
  }

  open(id) {
    const info = this.find(id);
    if (info?.path) shell.openPath(info.path);
  }

  show(id) {
    const info = this.find(id);
    if (info?.path) shell.showItemInFolder(info.path);
  }

  cancel(id) {
    this.active.get(id)?.item.cancel();
  }

  pause(id) {
    const a = this.active.get(id);
    if (!a) return;
    if (a.item.isPaused()) a.item.resume();
    else a.item.pause();
    a.info.paused = a.item.isPaused();
    this.emitNow();
  }

  remove(id) {
    this.file.data.items = this.file.data.items.filter((i) => i.id !== id);
    this.file.save();
    this.emitNow();
  }

  clear() {
    this.file.data.items = [];
    this.file.save();
    this.emitNow();
  }
}

module.exports = new Downloads();
