'use strict';
const { EventEmitter } = require('node:events');
const { JsonFile } = require('./store');

const DEFAULTS = {
  appearance: {
    theme: 'system', // system | light | dark
    accent: '#8B5CF6',
    verticalTabs: false,
    sidebarCollapsed: false,
    bookmarksBar: 'ntp', // always | ntp | never
    showHomeButton: false,
    compact: false,
    language: 'auto', // auto | en | hu
  },
  startup: {
    mode: 'restore', // newtab | restore | home
    homepage: 'imp://newtab',
  },
  search: {
    engine: 'duckduckgo',
    suggestions: true,
  },
  newtab: {
    showShortcuts: true,
    showStats: true,
    showClock: true,
    background: 'ember',
    shortcuts: [],
    hiddenSites: [],
  },
  shields: {
    adblock: 'standard', // off | standard | aggressive
    https: 'upgrade', // off | upgrade | strict
    thirdPartyCookies: true,
    gpc: true,
    allowlist: [],
  },
  privacy: {
    dns: 'automatic', // off | automatic | cloudflare | quad9 | google | custom
    dnsCustom: '',
    saveHistory: true,
    clearOnExit: false,
  },
  performance: {
    sleepingTabs: true,
    sleepAfter: 15, // minutes
    efficiency: 'auto', // auto | on | off
    hardwareAcceleration: true,
    preconnect: true,
  },
  downloads: {
    dir: '',
    ask: false,
  },
  meta: {
    firstRunDone: false,
    lastVersion: '',
  },
};

function deepMerge(base, extra) {
  const out = structuredClone(base);
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (!(k in out)) continue;
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else if (sameType(out[k], v)) out[k] = v;
  }
  return out;
}

function sameType(a, b) {
  if (Array.isArray(a)) return Array.isArray(b);
  return typeof a === typeof b;
}

class Settings extends EventEmitter {
  constructor() {
    super();
    this.file = null;
  }

  load() {
    if (this.file) return;
    this.file = new JsonFile('settings.json', {});
    this.file.data = deepMerge(DEFAULTS, this.file.data);
  }

  get data() {
    return this.file.data;
  }

  get(key) {
    return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.file.data);
  }

  set(key, value) {
    const parts = key.split('.');
    const last = parts.pop();
    let target = this.file.data;
    let defaults = DEFAULTS;
    for (const p of parts) {
      if (!target || typeof target[p] !== 'object') throw new Error(`Unknown setting: ${key}`);
      target = target[p];
      defaults = defaults[p];
    }
    if (!(last in defaults)) throw new Error(`Unknown setting: ${key}`);
    if (!sameType(defaults[last], value)) throw new Error(`Invalid value for ${key}`);
    if (JSON.stringify(target[last]) === JSON.stringify(value)) return;
    target[last] = value;
    this.file.save();
    this.emit('change', key, value);
  }

  reset() {
    this.file.data = deepMerge(DEFAULTS, { meta: this.file.data.meta });
    this.file.save();
    this.emit('change', '*', null);
  }
}

module.exports = new Settings();
module.exports.DEFAULTS = DEFAULTS;
