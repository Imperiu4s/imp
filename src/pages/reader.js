'use strict';
(async () => {
  const { t, call, esc } = window.Page;
  const $ = (s) => document.querySelector(s);
  const PREFS_KEY = 'imp-reader';
  const prefs = Object.assign({ size: 19, font: 'sans', theme: 'auto' }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));

  await window.Page.init();

  function applyPrefs() {
    document.body.style.setProperty('--r-size', `${prefs.size}px`);
    document.body.classList.toggle('r-serif', prefs.font === 'serif');
    document.body.className = document.body.className.replace(/r-theme-\w+/g, '').trim();
    document.body.classList.add(`r-theme-${prefs.theme}`);
    document.querySelectorAll('[data-font]').forEach((b) => b.classList.toggle('on', b.dataset.font === prefs.font));
    document.querySelectorAll('[data-rtheme]').forEach((b) => b.classList.toggle('on', b.dataset.rtheme === prefs.theme));
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  // The article comes from a website: strip anything active before showing it.
  function sanitize(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, iframe, frame, object, embed, form, input, button, textarea, select, link, meta, base, noscript').forEach((el) => el.remove());
    for (const el of doc.body.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'srcdoc') el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^(javascript|data:text|vbscript|imp):/.test(value)) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A' && el.getAttribute('href')) {
        try {
          el.setAttribute('href', new URL(el.getAttribute('href'), baseUrl).href);
        } catch {
          el.removeAttribute('href');
        }
      }
      if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
    }
    return doc.body.innerHTML;
  }

  const id = new URLSearchParams(location.search).get('id');
  const article = id ? await call('reader.get', id) : null;
  if (!article) {
    $('#title').textContent = t('reader.missing');
  } else {
    let host = '';
    try {
      host = new URL(article.url).hostname.replace(/^www\./, '');
    } catch {}
    document.title = article.title || t('reader.title');
    $('#site').textContent = article.siteName || host;
    $('#title').textContent = article.title || '';
    const words = (article.length || 0) / 5.5;
    const minutes = Math.max(1, Math.round(words / 230));
    $('#meta').innerHTML = [article.byline ? esc(article.byline) : '', esc(t('reader.minutes', { n: minutes }))].filter(Boolean).join(' · ');
    $('#body').innerHTML = sanitize(article.content, article.url);
    if (article.lang) document.documentElement.lang = article.lang;
    if (article.dir) $('#article').dir = article.dir;
    $('#orig').href = article.url;
  }

  $('#fonts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-font]');
    if (!b) return;
    prefs.font = b.dataset.font;
    applyPrefs();
  });
  $('#themes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rtheme]');
    if (!b) return;
    prefs.theme = b.dataset.rtheme;
    applyPrefs();
  });
  $('#smaller').addEventListener('click', () => {
    prefs.size = Math.max(14, prefs.size - 1);
    applyPrefs();
  });
  $('#bigger').addEventListener('click', () => {
    prefs.size = Math.min(30, prefs.size + 1);
    applyPrefs();
  });
  applyPrefs();
})();
