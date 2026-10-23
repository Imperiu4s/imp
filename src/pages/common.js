'use strict';
// Shared helpers for imp:// pages: API access, translations, theming.
(() => {
  const bridge = window.imp;
  const I18N = window.ImpI18n;
  const listeners = { settings: [], event: [] };
  let lang = 'en';
  let settings = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const t = (key, vars) => I18N.translate(lang, key, vars);
  const call = (method, ...args) => bridge.call(method, ...args);

  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    document.documentElement.dataset.theme = darkMQ.matches ? 'dark' : 'light';
    if (settings) document.documentElement.style.setProperty('--accent', settings.appearance.accent);
  }
  darkMQ.addEventListener('change', applyTheme);
  applyTheme();

  function applyI18n(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (!el.dataset.iconDone) {
        el.insertAdjacentHTML('afterbegin', window.ImpIcons.icon(el.dataset.icon, Number(el.dataset.size || 16)));
        el.dataset.iconDone = '1';
      }
    });
    if (document.body.dataset.titleKey) document.title = t(document.body.dataset.titleKey);
  }

  function updateLang() {
    lang = I18N.detect(settings?.appearance.language, navigator.language);
  }

  function toast(text) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function fmtBytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  function faviconHtml(url, size = 18) {
    if (url) return `<img src="${esc(url)}" width="${size}" height="${size}" alt="" loading="lazy" data-fallback="globe">`;
    return window.ImpIcons.icon('globe', size - 2);
  }

  function fixImages(root = document) {
    root.querySelectorAll('img[data-fallback]:not([data-fixed])').forEach((img) => {
      img.dataset.fixed = '1';
      img.addEventListener('error', () => {
        img.outerHTML = window.ImpIcons.icon(img.dataset.fallback || 'globe', 16);
      });
    });
  }

  async function init() {
    settings = await call('settings.get');
    updateLang();
    applyTheme();
    applyI18n();
    bridge.on((type, data) => {
      if (type === 'settings') {
        settings = data;
        updateLang();
        applyTheme();
        applyI18n();
        listeners.settings.forEach((fn) => fn(settings));
      }
      listeners.event.forEach((fn) => fn(type, data));
    });
    return settings;
  }

  window.Page = {
    init,
    call,
    t,
    esc,
    toast,
    fmtBytes,
    hostOf,
    faviconHtml,
    fixImages,
    applyI18n,
    icon: (name, size) => window.ImpIcons.icon(name, size),
    get settings() {
      return settings;
    },
    get lang() {
      return lang;
    },
    onSettings: (fn) => listeners.settings.push(fn),
    onEvent: (fn) => listeners.event.push(fn),
  };
})();
