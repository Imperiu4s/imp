'use strict';
// Automatic updates from GitHub Releases (only in installed builds).
const { app } = require('electron');

let autoUpdater = null;
let manager = null;

function set(state) {
  manager.updateState = state;
  manager.broadcast('state:update', state);
  manager.notifyPages('update', state);
}

function init(windowManager) {
  manager = windowManager;
  if (!app.isPackaged || process.env.IMP_DISABLE_UPDATES) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ ...(manager.updateState || {}), state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('error', (err) => set({ state: 'error', message: String(err?.message || err).split('\n')[0] }));
  setTimeout(() => check(), 30_000);
  setInterval(() => check(), 6 * 60 * 60 * 1000);
}

async function check() {
  if (!autoUpdater) return { state: 'unavailable' };
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    set({ state: 'error', message: String(err?.message || err).split('\n')[0] });
  }
  return manager.updateState;
}

function install() {
  if (autoUpdater && manager.updateState?.state === 'ready') {
    manager.quitting = true;
    manager.saveSession();
    autoUpdater.quitAndInstall(false, true);
  }
}

module.exports = { init, check, install };
