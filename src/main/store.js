'use strict';
// Small JSON persistence helpers with debounced, atomic writes.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const files = new Set();

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(name, data) {
  const file = dataPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

class JsonFile {
  constructor(name, defaults) {
    this.name = name;
    this.data = readJson(name, null) ?? structuredClone(defaults);
    this.timer = null;
    files.add(this);
  }

  save(delay = 800) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      writeJsonSync(this.name, this.data);
    } catch (err) {
      console.error(`[store] failed to save ${this.name}:`, err);
    }
  }

  get dirty() {
    return this.timer !== null;
  }
}

function flushAll() {
  for (const f of files) if (f.dirty) f.flush();
}

module.exports = { JsonFile, dataPath, readJson, writeJsonSync, flushAll };
