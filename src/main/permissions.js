'use strict';
// Site permissions: remembered decisions + prompting through the tab infobar.
const { EventEmitter } = require('node:events');
const { JsonFile } = require('./store');

const AUTO_ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'fileSystem',
  'speaker-selection',
]);
const ASKABLE = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'display-capture',
  'midi',
  'midiSysex',
  'idle-detection',
  'window-management',
  'openExternal',
]);

function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? '' : u.origin;
  } catch {
    return '';
  }
}

class Permissions extends EventEmitter {
  load() {
    this.file = new JsonFile('permissions.json', { sites: {} });
  }

  get sites() {
    return this.file.data.sites;
  }

  kindsFor(permission, details) {
    if (permission === 'media') {
      const types = details?.mediaTypes?.length ? details.mediaTypes : ['video', 'audio'];
      return [...new Set(types.map((t) => (t === 'video' ? 'camera' : 'microphone')))];
    }
    if (permission === 'midiSysex') return ['midi'];
    return [permission];
  }

  decision(origin, kind) {
    return this.sites[origin]?.[kind];
  }

  set(origin, kind, value) {
    if (!origin) return;
    if (!this.sites[origin]) this.sites[origin] = {};
    if (value) this.sites[origin][kind] = value;
    else delete this.sites[origin][kind];
    if (!Object.keys(this.sites[origin]).length) delete this.sites[origin];
    this.file.save();
    this.emit('change');
  }

  clearSite(origin) {
    delete this.sites[origin];
    this.file.save();
    this.emit('change');
  }

  list() {
    return Object.entries(this.sites).map(([origin, perms]) => ({ origin, perms }));
  }

  // findTab(webContents) -> Tab | null ; prompt is handled by the tab's window
  setupSession(ses, findTab, isPrivate) {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const url = details?.requestingUrl || wc?.getURL() || '';
      if (url.startsWith('imp:')) return callback(true);
      if (AUTO_ALLOW.has(permission)) return callback(true);
      if (!ASKABLE.has(permission)) return callback(false);
      const origin = originOf(url);
      if (!origin) return callback(false);
      const kinds = this.kindsFor(permission, details);
      const decisions = kinds.map((k) => this.decision(origin, k));
      if (decisions.every((d) => d === 'allow')) return callback(true);
      if (decisions.some((d) => d === 'block')) return callback(false);
      const tab = wc && findTab(wc);
      if (!tab) return callback(false);
      tab.win.requestPermission(tab, {
        origin,
        kinds,
        callback: (allow, remember = true) => {
          if (remember && !isPrivate) kinds.forEach((k) => this.set(origin, k, allow ? 'allow' : 'block'));
          callback(allow);
        },
      });
    });

    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if ((requestingOrigin || '').startsWith('imp:')) return true;
      if (AUTO_ALLOW.has(permission)) return true;
      const origin = originOf(requestingOrigin || details?.requestingUrl || '');
      if (!origin) return false;
      if (permission === 'media') {
        const kind = details?.mediaType === 'video' ? 'camera' : 'microphone';
        return this.decision(origin, kind) === 'allow';
      }
      return this.decision(origin, permission === 'midiSysex' ? 'midi' : permission) === 'allow';
    });
  }
}

module.exports = new Permissions();
