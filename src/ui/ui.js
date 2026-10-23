'use strict';
// Imp browser chrome: tab strip, toolbar, address bar, bookmarks bar, find bar.
(() => {
  const { icon } = window.ImpIcons;
  const I18N = window.ImpI18n;
  const api = window.imp;
  const $ = (sel) => document.querySelector(sel);
  const NEW_TAB = 'imp://newtab/';
  const params = new URLSearchParams(location.search);
  const isPrivate = params.get('private') === '1';
  const platform = params.get('platform');
  const INTERNAL_ICONS = { settings: 'settings', history: 'history', bookmarks: 'bookmark', downloads: 'download', performance: 'zap', reader: 'reader' };

  let lang = 'en';
  const t = (key, vars) => I18N.translate(lang, key, vars);
  let settings = null;
  let state = { tabs: [], activeId: null, split: null, splitRatio: 0.5, bookmarked: false };
  let bookmarks = [];
  let downloads = { count: 0, fraction: -1, hasDownloads: false };
  let update = null;
  let popupOpen = null;
  let lastPopupClose = { type: null, time: 0 };
  let lastActiveId = null;
  let winFullscreen = false;
  let htmlFullscreen = false;
  const tabEls = new Map();
  const attention = new Set();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  document.body.classList.toggle('mac', platform === 'darwin');

  // ------------------------------------------------------------------ theme & settings
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    document.body.dataset.theme = isPrivate ? 'private' : darkMQ.matches ? 'dark' : 'light';
    if (settings && !isPrivate) document.documentElement.style.setProperty('--accent', settings.appearance.accent);
  }
  darkMQ.addEventListener('change', applyTheme);
  applyTheme();

  function applySettings() {
    if (!settings) return;
    const a = settings.appearance;
    document.body.classList.toggle('vertical', !!a.verticalTabs);
    document.body.classList.toggle('collapsed', !!a.sidebarCollapsed);
    document.body.classList.toggle('compact', !!a.compact);
    $('#btn-home').hidden = !a.showHomeButton;
    applyTheme();
    render();
    renderBookmarks();
    reportBounds();
  }

  // ------------------------------------------------------------------ static setup
  const setIcon = (sel, name, size = 17) => {
    $(sel).insertAdjacentHTML('afterbegin', icon(name, size));
  };
  setIcon('#btn-back', 'back');
  setIcon('#btn-forward', 'forward');
  setIcon('#btn-reload', 'reload');
  setIcon('#btn-home', 'home');
  setIcon('#btn-reader', 'reader', 16);
  setIcon('#btn-star', 'star', 16);
  setIcon('#btn-shields', 'shieldCheck', 18);
  setIcon('#btn-split', 'split');
  setIcon('#btn-downloads', 'download');
  setIcon('#btn-menu', 'more', 18);
  setIcon('#btn-sidebar', 'sidebar');
  setIcon('#new-tab-h', 'plus', 17);
  $('#new-tab-v .ic-wrap').innerHTML = icon('plus', 16);
  $('#find-prev').innerHTML = icon('chevronUp', 15);
  $('#find-next').innerHTML = icon('chevronDown', 15);
  $('#find-close').innerHTML = icon('close', 15);
  $('.find-icon').innerHTML = icon('search', 15);

  function applyStrings() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-tip]').forEach((el) => {
      el.title = t(el.dataset.tip);
    });
    $('#url').placeholder = t(isPrivate ? 'omnibox.placeholderPrivate' : 'omnibox.placeholder');
    $('#new-tab-v .label').textContent = t('tip.newTab');
    $('#private-pill').innerHTML = `${icon('incognito', 15)}<span>${esc(t('private'))}</span>`;
    $('#private-pill').hidden = !isPrivate;
    $('#find-input').placeholder = t('find.placeholder');
    $('#find-prev').title = t('find.prev');
    $('#find-next').title = t('find.next');
    $('#find-close').title = t('find.close');
    $('#infobar [data-act="allow"]').textContent = t('perm.allow');
    $('#infobar [data-act="block"]').textContent = t('perm.block');
    for (const el of tabEls.values()) el._s = {};
    render();
    renderBookmarks();
  }

  // ------------------------------------------------------------------ tabs
  const activeTab = () => state.tabs.find((tab) => tab.id === state.activeId) || null;
  const tabsContainer = () => (settings?.appearance.verticalTabs ? $('#tabs-v') : $('#tabs-h'));

  function tabIconKey(tab) {
    if (tab.loading && !tab.sleeping) return 'loading';
    if (tab.crashed) return 'crash';
    if (tab.url.startsWith('imp://')) {
      const page = tab.url.slice(8).split(/[/?#]/)[0];
      return INTERNAL_ICONS[page] ? `i:${INTERNAL_ICONS[page]}` : 'imp';
    }
    return tab.favicon || 'i:globe';
  }

  function createTabEl(id) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.id = id;
    el.innerHTML = `<div class="tab-icon"></div><div class="tab-title"></div><button class="tab-audio" hidden></button><button class="tab-close">${icon('close', 13)}</button>`;
    el._s = {};
    el.addEventListener('pointerdown', onTabPointerDown);
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        api.send('tab:close', id);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      api.send('tab:menu', id);
    });
    const close = el.querySelector('.tab-close');
    const audio = el.querySelector('.tab-audio');
    for (const b of [close, audio]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      api.send('tab:close', id);
    });
    audio.addEventListener('click', (e) => {
      e.stopPropagation();
      api.send('tab:mute', id);
    });
    return el;
  }

  function updateTabEl(el, tab) {
    const s = el._s;
    const title = tab.title || (tab.url === NEW_TAB ? t('newTab') : tab.url);
    if (s.title !== title) {
      s.title = title;
      el.querySelector('.tab-title').textContent = title;
    }
    const tip = title + (tab.sleeping ? ` — ${t('tab.sleeping')}` : '');
    if (el.title !== tip) el.title = tip;
    const key = tabIconKey(tab);
    if (s.icon !== key) {
      s.icon = key;
      const box = el.querySelector('.tab-icon');
      if (key === 'loading') box.innerHTML = '<div class="spinner"></div>';
      else if (key === 'crash') box.innerHTML = icon('warning', 15);
      else if (key === 'imp') box.innerHTML = '<img src="assets/icon.svg" alt="">';
      else if (key.startsWith('i:')) box.innerHTML = icon(key.slice(2), 15);
      else {
        const img = document.createElement('img');
        img.alt = '';
        img.src = key;
        img.onerror = () => {
          box.innerHTML = icon('globe', 15);
        };
        box.replaceChildren(img);
      }
    }
    const audioKey = tab.muted ? 'mute' : tab.audible ? 'volume' : '';
    if (s.audio !== audioKey) {
      s.audio = audioKey;
      const audio = el.querySelector('.tab-audio');
      audio.hidden = !audioKey;
      if (audioKey) {
        audio.innerHTML = icon(audioKey, 14);
        audio.title = t(tab.muted ? 'tab.unmute' : 'tab.mute');
      }
    }
    el.classList.toggle('active', tab.id === state.activeId);
    el.classList.toggle('pinned', !!tab.pinned);
    el.classList.toggle('sleeping', !!tab.sleeping);
    el.classList.toggle('in-split', !!state.split && (state.split.left === tab.id || state.split.right === tab.id));
    el.classList.toggle('attention', attention.has(tab.id) && tab.id !== state.activeId);
  }

  function render() {
    if (!settings) return;
    const container = tabsContainer();
    const ids = new Set(state.tabs.map((tab) => tab.id));
    for (const [id, el] of tabEls) {
      if (!ids.has(id)) {
        el.remove();
        tabEls.delete(id);
      }
    }
    let prev = null;
    for (const tab of state.tabs) {
      let el = tabEls.get(tab.id);
      if (!el) {
        el = createTabEl(tab.id);
        tabEls.set(tab.id, el);
      }
      updateTabEl(el, tab);
      if (!drag?.active) {
        const expected = prev ? prev.nextSibling : container.firstChild;
        if (el.parentNode !== container || expected !== el) container.insertBefore(el, expected);
      }
      prev = el;
    }
    if (state.activeId !== lastActiveId) {
      lastActiveId = state.activeId;
      attention.delete(state.activeId);
      closeFind(false);
      if (document.activeElement !== urlInput) userTyped = false;
      tabEls.get(state.activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateNarrow();
    updateToolbar();
    renderInfobar();
    updateBookmarksBarVisibility();
    renderSplit();
  }

  function updateNarrow() {
    if (settings?.appearance.verticalTabs) {
      for (const el of tabEls.values()) el.classList.remove('narrow');
      return;
    }
    const sample = [...tabEls.values()].find((el) => !el.classList.contains('pinned'));
    const narrow = sample ? sample.getBoundingClientRect().width < 112 : false;
    for (const el of tabEls.values()) el.classList.toggle('narrow', narrow);
  }

  // drag to reorder
  let drag = null;
  function onTabPointerDown(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const id = Number(el.dataset.id);
    if (id !== state.activeId) api.send('tab:activate', id);
    drag = { id, el, x: e.clientX, y: e.clientY, active: false };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', onTabPointerMove);
    el.addEventListener('pointerup', onTabPointerUp, { once: true });
    el.addEventListener('pointercancel', onTabPointerUp, { once: true });
  }

  function onTabPointerMove(e) {
    if (!drag) return;
    const vertical = settings.appearance.verticalTabs;
    const delta = vertical ? e.clientY - drag.y : e.clientX - drag.x;
    if (!drag.active && Math.abs(delta) < 6) return;
    if (!drag.active) {
      drag.active = true;
      drag.el.classList.add('dragging');
    }
    const container = drag.el.parentNode;
    const pinned = drag.el.classList.contains('pinned');
    const siblings = [...container.children].filter((c) => c !== drag.el && c.classList.contains('tab') && c.classList.contains('pinned') === pinned);
    const pos = vertical ? e.clientY : e.clientX;
    let idx = 0;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (pos > (vertical ? r.top + r.height / 2 : r.left + r.width / 2)) idx++;
    }
    const ref = siblings[idx];
    if (ref) {
      if (drag.el.nextElementSibling !== ref) container.insertBefore(drag.el, ref);
    } else if (siblings.length) {
      const last = siblings[siblings.length - 1];
      if (last.nextElementSibling !== drag.el) last.after(drag.el);
    }
  }

  function onTabPointerUp() {
    if (!drag) return;
    const { el, id, active } = drag;
    el.removeEventListener('pointermove', onTabPointerMove);
    el.classList.remove('dragging');
    drag = null;
    if (active) {
      const index = [...el.parentNode.querySelectorAll('.tab')].indexOf(el);
      api.send('tab:move', id, index);
    }
  }

  $('#tabs-h').addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        $('#tabs-h').scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  $('#tabs-h').addEventListener('dblclick', (e) => {
    if (e.target.id === 'tabs-h') api.send('tab:new', {});
  });

  // ------------------------------------------------------------------ toolbar
  const urlInput = $('#url');
  const omnibox = $('#omnibox');
  let userTyped = false;

  function displayUrl(url) {
    if (!url || url === NEW_TAB) return '';
    if (url.startsWith('imp://reader/')) return 'imp://reader';
    if (url.startsWith('imp://')) return url.replace(/\/(?=$|[?#])/, '');
    try {
      const u = new URL(url);
      let s = url;
      if (u.protocol === 'https:') s = url.slice(8);
      if (u.pathname === '/' && !u.search && !u.hash) s = s.replace(/\/$/, '');
      try {
        s = decodeURI(s);
      } catch {}
      return s;
    } catch {
      return url;
    }
  }

  function fullUrl(tab) {
    if (!tab || tab.url === NEW_TAB) return '';
    try {
      return decodeURI(tab.url);
    } catch {
      return tab.url;
    }
  }

  function updateToolbar() {
    const tab = activeTab();
    $('#btn-back').disabled = !tab?.canGoBack;
    $('#btn-forward').disabled = !tab?.canGoForward;
    const loading = !!tab?.loading;
    const reload = $('#btn-reload');
    if (reload.dataset.state !== String(loading)) {
      reload.dataset.state = String(loading);
      reload.innerHTML = icon(loading ? 'close' : 'reload', 17);
      reload.title = t(loading ? 'tip.stop' : 'tip.reload');
    }
    $('#loadbar').classList.toggle('loading', loading);

    if (document.activeElement !== urlInput && !userTyped) {
      const value = displayUrl(tab?.url);
      if (urlInput.value !== value) urlInput.value = value;
    } else if (document.activeElement === urlInput && !userTyped) {
      const value = fullUrl(tab);
      if (urlInput.value !== value && urlInput.selectionStart === 0 && urlInput.selectionEnd === urlInput.value.length) {
        urlInput.value = value;
        urlInput.select();
      }
    }

    const url = tab?.url || '';
    const site = $('#site-btn');
    let siteKind = 'search';
    if (url === NEW_TAB || !url) siteKind = 'search';
    else if (tab.error) siteKind = 'other';
    else if (url.startsWith('imp://')) siteKind = 'internal';
    else if (url.startsWith('https://')) siteKind = 'secure';
    else if (url.startsWith('http://')) siteKind = 'insecure';
    else if (url.startsWith('file:')) siteKind = 'file';
    else siteKind = 'other';
    if (site.dataset.kind !== siteKind || site.dataset.lang !== lang) {
      site.dataset.kind = siteKind;
      site.dataset.lang = lang;
      site.className = `site-btn ${siteKind}`;
      const map = {
        search: icon('search', 15),
        internal: `<img src="assets/icon.svg" width="15" height="15" alt="">`,
        secure: icon('lock', 15),
        insecure: `${icon('warning', 15)}<span>${esc(t('site.notSecure'))}</span>`,
        file: icon('file', 15),
        other: icon('info', 15),
      };
      site.innerHTML = map[siteKind];
    }

    const star = $('#btn-star');
    const canStar = !isPrivate && /^(https?|file):/.test(url);
    star.hidden = !canStar;
    if (star.dataset.on !== String(state.bookmarked)) {
      star.dataset.on = String(state.bookmarked);
      star.classList.toggle('starred', !!state.bookmarked);
      star.innerHTML = icon(state.bookmarked ? 'starFill' : 'star', 16);
      star.title = t(state.bookmarked ? 'tip.editBookmark' : 'tip.bookmark');
    }

    const reader = $('#btn-reader');
    const inReader = url.startsWith('imp://reader/');
    reader.hidden = !(tab?.readerable || inReader);
    reader.classList.toggle('on', inReader);

    const zoom = $('#zoom-chip');
    const z = tab ? Math.round((tab.zoom || 1) * 100) : 100;
    zoom.hidden = z === 100;
    zoom.textContent = `${z}%`;
    zoom.title = t('tip.zoomReset');

    const shields = $('#btn-shields');
    const web = /^https?:/.test(url);
    shields.classList.toggle('sh-on', web && tab.shieldsOn);
    shields.classList.toggle('sh-off', !web || !tab.shieldsOn);
    const shieldIcon = web && !tab.shieldsOn ? 'shieldOff' : 'shieldCheck';
    if (shields.dataset.icon !== shieldIcon) {
      shields.dataset.icon = shieldIcon;
      shields.querySelector('svg')?.remove();
      shields.insertAdjacentHTML('afterbegin', icon(shieldIcon, 18));
    }
    const badge = shields.querySelector('.badge');
    const blocked = web && tab.shieldsOn ? tab.blocked : 0;
    badge.hidden = !blocked;
    badge.textContent = blocked > 99 ? '99+' : String(blocked);

    $('#btn-split').classList.toggle('on', !!state.split);
    updatePopupButtons();
  }

  function updatePopupButtons() {
    $('#btn-menu').classList.toggle('on', popupOpen === 'menu');
    $('#btn-downloads').classList.toggle('on', popupOpen === 'downloads');
    $('#site-btn').classList.toggle('on', popupOpen === 'siteinfo');
    if (popupOpen === 'shields') $('#btn-shields').classList.add('pressed');
    else $('#btn-shields').classList.remove('pressed');
  }

  function anchorOf(el, align = 'right', gap = 4) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, align, gap };
  }

  function togglePopup(type, el, align = 'right', extra) {
    if (popupOpen === type) {
      api.send('popup:close', type);
      return;
    }
    if (lastPopupClose.type === type && Date.now() - lastPopupClose.time < 300) return;
    closeSuggest();
    api.send('popup:open', type, anchorOf(el, align), extra);
    popupOpen = type;
    updatePopupButtons();
  }

  $('#btn-back').addEventListener('click', () => api.send('ui:command', 'back'));
  $('#btn-forward').addEventListener('click', () => api.send('ui:command', 'forward'));
  $('#btn-reload').addEventListener('click', (e) => api.send('ui:command', activeTab()?.loading ? 'stop' : e.shiftKey || e.ctrlKey ? 'hard-reload' : 'reload'));
  $('#btn-home').addEventListener('click', () => api.send('ui:command', 'home'));
  $('#btn-reader').addEventListener('click', () => api.send('ui:command', 'reader'));
  $('#zoom-chip').addEventListener('click', () => api.send('ui:command', 'zoom-reset'));
  $('#btn-split').addEventListener('click', () => api.send('ui:command', 'toggle-split'));
  $('#btn-shields').addEventListener('click', (e) => togglePopup('shields', e.currentTarget));
  $('#btn-downloads').addEventListener('click', (e) => togglePopup('downloads', e.currentTarget));
  $('#btn-menu').addEventListener('click', (e) => togglePopup('menu', e.currentTarget));
  $('#site-btn').addEventListener('click', (e) => {
    const url = activeTab()?.url || '';
    if (!url || url === NEW_TAB) return urlInput.focus();
    togglePopup('siteinfo', e.currentTarget, 'left');
  });
  $('#btn-star').addEventListener('click', (e) => togglePopup('bookmark', e.currentTarget));
  $('#new-tab-h').addEventListener('click', () => api.send('tab:new', {}));
  $('#new-tab-v').addEventListener('click', () => api.send('tab:new', {}));
  $('#btn-sidebar').addEventListener('click', () => api.send('ui:setting', 'appearance.sidebarCollapsed', !settings.appearance.sidebarCollapsed));
  for (const id of ['#btn-back', '#btn-forward']) {
    $(id).addEventListener('auxclick', (e) => {
      if (e.button === 1) api.send('ui:command', 'duplicate-tab');
    });
  }

  // ------------------------------------------------------------------ address bar
  // zero: the list shows your recent searches (opened by clicking the empty bar)
  const suggest = { open: false, zero: false, items: [], selected: 0, text: '', seq: 0, local: null, remote: [], completedUrl: null };
  let lastInputType = '';
  let selectOnUp = false;
  let warmedUp = false;
  const preconnected = new Set();

  function preconnect(url) {
    try {
      const origin = new URL(url).origin;
      if (preconnected.has(origin) || !/^https?:/.test(origin)) return;
      preconnected.add(origin);
      api.send('omnibox:preconnect', origin);
    } catch {}
  }

  urlInput.addEventListener('mousedown', () => {
    if (document.activeElement !== urlInput || !document.hasFocus()) selectOnUp = true;
  });
  urlInput.addEventListener('mouseup', (e) => {
    if (selectOnUp) {
      e.preventDefault();
      urlInput.select();
      selectOnUp = false;
    }
    // Clicking the address bar always brings up your recent searches.
    if (!userTyped && !suggest.open) showRecent();
  });
  urlInput.addEventListener('focus', () => {
    omnibox.classList.add('focused');
    if (!userTyped) {
      urlInput.value = fullUrl(activeTab());
      urlInput.select();
    }
    // Open a connection to the search engine now, so the search starts instantly.
    if (!warmedUp) {
      warmedUp = true;
      api.send('omnibox:warmup');
    }
  });
  urlInput.addEventListener('blur', () => {
    omnibox.classList.remove('focused');
    setTimeout(() => {
      if (document.activeElement === urlInput) return;
      closeSuggest();
      userTyped = false;
      urlInput.value = displayUrl(activeTab()?.url);
      urlInput.scrollLeft = 0;
    }, 150);
  });
  urlInput.addEventListener('beforeinput', (e) => {
    lastInputType = e.inputType || '';
  });
  urlInput.addEventListener('input', () => {
    userTyped = true;
    onOmniboxInput();
  });

  async function showRecent() {
    const seq = ++suggest.seq;
    const list = await api.invoke('omnibox:recent');
    if (seq !== suggest.seq || userTyped || document.activeElement !== urlInput || !Array.isArray(list)) return;
    if (!list.length) return closeSuggest();
    suggest.zero = true;
    suggest.text = '';
    suggest.completedUrl = null;
    suggest.items = list.map((q) => ({ kind: 'recent', icon: 'history', title: q, query: q, sub: '', removable: true }));
    suggest.selected = -1;
    showSuggest();
  }

  async function onOmniboxInput() {
    const text = urlInput.value;
    suggest.text = text;
    suggest.zero = false;
    const seq = ++suggest.seq;
    if (!text.trim()) {
      closeSuggest();
      showRecent();
      return;
    }
    const res = await api.invoke('omnibox:suggest', text);
    if (seq !== suggest.seq || !res) return;
    suggest.local = res;
    suggest.completedUrl = null;
    const deleting = lastInputType.startsWith('delete');
    if (res.autocomplete && !deleting && urlInput.selectionStart === text.length && urlInput.selectionEnd === text.length && urlInput.value === text) {
      const comp = res.autocomplete.completion;
      if (comp.toLowerCase().startsWith(text.toLowerCase()) && comp.length > text.length) {
        urlInput.value = text + comp.slice(text.length);
        urlInput.setSelectionRange(text.length, urlInput.value.length);
        suggest.completedUrl = res.autocomplete.url;
      }
    }
    if (!suggest.remote.length || !suggest.remoteFor || !text.toLowerCase().startsWith(suggest.remoteFor.toLowerCase())) suggest.remote = [];
    buildSuggestions();
    api.invoke('omnibox:remote', text).then((list) => {
      if (seq !== suggest.seq || !Array.isArray(list)) return;
      suggest.remote = list;
      suggest.remoteFor = text;
      buildSuggestions();
    });
  }

  function shortUrl(url) {
    return displayUrl(url).replace(/^www\./, '');
  }

  function buildSuggestions() {
    const res = suggest.local;
    if (!res) return;
    const text = suggest.text.trim();
    const items = [];
    const seen = new Set();
    const push = (item) => {
      const key = item.url || `q:${item.query}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };
    if (suggest.completedUrl) {
      push({ kind: 'url', icon: 'globe', title: urlInput.value, url: suggest.completedUrl, sub: '' });
    } else if (res.resolved) {
      if (res.resolved.isSearch) push({ kind: 'search', icon: 'search', title: text, query: text, sub: t('omnibox.searchWith', { engine: res.engine }) });
      else push({ kind: 'url', icon: 'globe', title: text, url: res.resolved.url, sub: t('omnibox.open') });
    }
    for (const q of res.recent || []) push({ kind: 'recent', icon: 'history', title: q, query: q, sub: t('omnibox.searchedBefore'), removable: true });
    for (const it of res.items) {
      push({ kind: it.type, icon: it.type === 'bookmark' ? 'star' : 'history', title: it.title || it.url, url: it.url, sub: shortUrl(it.url), favicon: it.favicon });
    }
    if (items[0] && items[0].kind !== 'search' && text) push({ kind: 'search', icon: 'search', title: text, query: text, sub: t('omnibox.searchWith', { engine: res.engine }) });
    for (const s of suggest.remote) push({ kind: 'suggestion', icon: 'search', title: s, query: s, sub: '' });
    suggest.items = items.slice(0, 10);
    suggest.selected = 0;
    if (items[0]?.url) preconnect(items[0].url);
    showSuggest();
  }

  function suggestData() {
    return {
      items: suggest.items,
      selected: suggest.selected,
      width: omnibox.getBoundingClientRect().width,
      title: suggest.zero ? t('omnibox.recent') : '',
    };
  }

  function showSuggest() {
    if (!suggest.items.length) return closeSuggest();
    const data = suggestData();
    if (!suggest.open) {
      suggest.open = true;
      popupOpen = 'suggest';
      api.send('popup:open', 'suggest', anchorOf(omnibox, 'left', 4), data);
    } else {
      api.send('popup:update', 'suggest', data);
    }
  }

  function closeSuggest() {
    if (!suggest.open) return;
    suggest.open = false;
    if (popupOpen === 'suggest') popupOpen = null;
    api.send('popup:close', 'suggest');
  }

  function moveSelection(delta) {
    if (!suggest.open || !suggest.items.length) return;
    const n = suggest.items.length;
    if (suggest.selected < 0) suggest.selected = delta > 0 ? 0 : n - 1;
    else suggest.selected = (suggest.selected + delta + n) % n;
    const item = suggest.items[suggest.selected];
    urlInput.value = item.url && item.kind !== 'url' ? item.url : item.query || item.title;
    if (suggest.selected === 0 && !suggest.zero) urlInput.value = suggest.completedUrl ? urlInput.value : suggest.text;
    if (item.url) preconnect(item.url);
    api.send('popup:update', 'suggest', suggestData());
  }

  const SEARCH_KINDS = new Set(['search', 'suggestion', 'recent']);
  function go(item, disposition = 'current') {
    if (SEARCH_KINDS.has(item.kind)) api.send('nav:go', `?${item.query || item.title}`, { disposition });
    else if (item.url) api.send('nav:url', item.url, { disposition, typed: true });
  }

  // The × next to a remembered search in the list.
  async function removeSuggestion({ index }) {
    const item = suggest.items[index];
    if (!item || !item.removable) return;
    await api.invoke('omnibox:forget', item.query);
    urlInput.focus();
    if (suggest.zero) return showRecent();
    suggest.items.splice(index, 1);
    if (suggest.selected >= suggest.items.length) suggest.selected = suggest.items.length - 1;
    showSuggest();
  }

  function finishOmnibox() {
    closeSuggest();
    userTyped = false;
    suggest.zero = false;
    suggest.items = [];
    suggest.remote = [];
  }

  function commit(e) {
    const text = urlInput.value.trim();
    if (!text) return;
    const disposition = e.altKey ? 'new-tab' : 'current';
    const picked = suggest.open ? suggest.items[suggest.selected] : null;
    if (e.ctrlKey && /^[\p{L}\p{N}-]+$/u.test(text)) {
      api.send('nav:go', `www.${text}.com`, { disposition });
    } else if (picked && (suggest.zero || suggest.selected > 0)) {
      go(picked, disposition);
    } else if (suggest.completedUrl && urlInput.value.toLowerCase().startsWith(suggest.text.toLowerCase())) {
      api.send('nav:url', suggest.completedUrl, { disposition, typed: true });
    } else {
      api.send('nav:go', text, { disposition });
    }
    finishOmnibox();
  }

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggest.open) {
        e.preventDefault();
        moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (suggest.open) {
        closeSuggest();
        urlInput.value = suggest.zero ? fullUrl(activeTab()) : suggest.text;
        if (suggest.zero) urlInput.select();
      } else {
        userTyped = false;
        urlInput.value = fullUrl(activeTab());
        api.send('ui:command', 'focus-page');
      }
    } else if (e.key === 'Tab' && suggest.open && !e.shiftKey && suggest.completedUrl) {
      e.preventDefault();
      urlInput.setSelectionRange(urlInput.value.length, urlInput.value.length);
    }
  });

  function pickSuggestion({ index, middle }) {
    const item = suggest.items[index];
    if (!item) return;
    go(item, middle ? 'new-tab' : 'current');
    finishOmnibox();
  }

  // ------------------------------------------------------------------ bookmarks bar
  function bookmarkIcon(b) {
    if (b.type === 'folder') return icon('folder', 16);
    if (b.favicon) return `<img src="${esc(b.favicon)}" alt="">`;
    return icon('globe', 16);
  }

  function renderBookmarks() {
    if (!settings) return;
    const bar = $('#bookmarks-bar');
    bar.textContent = '';
    const items = bookmarks.filter((b) => b.parent === 'bar');
    if (!items.length) {
      bar.innerHTML = `<span class="bm-empty">${esc(t('bm.empty'))}</span>`;
    }
    for (const b of items) {
      const btn = document.createElement('button');
      btn.className = 'bm';
      btn.title = b.type === 'folder' ? b.title : `${b.title}\n${b.url}`;
      btn.innerHTML = `${bookmarkIcon(b)}<span>${esc(b.title || b.url)}</span>`;
      btn.querySelector('img')?.addEventListener('error', (ev) => ev.target.replaceWith(document.createRange().createContextualFragment(icon('globe', 16))));
      btn.addEventListener('click', (e) => {
        if (b.type === 'folder') return togglePopup('bmfolder', btn, 'left', { folder: b.id, title: b.title });
        const bg = e.ctrlKey || e.metaKey;
        api.send('nav:url', b.url, bg ? { disposition: 'new-tab', background: true } : { disposition: e.shiftKey ? 'new-tab' : 'current' });
      });
      btn.addEventListener('auxclick', (e) => {
        if (e.button === 1 && b.type === 'bookmark') api.send('nav:url', b.url, { disposition: 'new-tab', background: true });
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        api.send('bookmark:menu', b.id);
      });
      bar.appendChild(btn);
    }
    requestAnimationFrame(fitBookmarks);
    updateBookmarksBarVisibility();
  }

  function fitBookmarks() {
    const bar = $('#bookmarks-bar');
    bar.querySelector('.bm-overflow')?.remove();
    const buttons = [...bar.querySelectorAll('.bm')];
    buttons.forEach((b) => (b.hidden = false));
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
    const more = document.createElement('button');
    more.className = 'icon-btn small bm-overflow';
    more.innerHTML = icon('chevronsRight', 15);
    more.title = t('bm.more');
    more.addEventListener('click', () => togglePopup('bmfolder', more, 'right', { folder: 'bar', title: '' }));
    bar.appendChild(more);
    const limit = bar.clientWidth - 40;
    for (const b of buttons) b.hidden = b.offsetLeft + b.offsetWidth > limit;
  }

  function updateBookmarksBarVisibility() {
    if (!settings) return;
    const mode = settings.appearance.bookmarksBar;
    const tab = activeTab();
    const show = mode === 'always' || (mode === 'ntp' && (!tab || tab.url === NEW_TAB));
    const bar = $('#bookmarks-bar');
    if (bar.classList.contains('hidden') === show) {
      bar.classList.toggle('hidden', !show);
      if (show) requestAnimationFrame(fitBookmarks);
      reportBounds();
    }
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitBookmarks));

  // ------------------------------------------------------------------ permission infobar
  const PERM_ICONS = { camera: 'video', microphone: 'mic', geolocation: 'mapPin', notifications: 'bell', 'clipboard-read': 'clipboard', 'display-capture': 'monitor' };
  function renderInfobar() {
    const tab = activeTab();
    const p = tab?.permission;
    const bar = $('#infobar');
    const wasHidden = bar.hidden;
    if (!p) {
      bar.hidden = true;
    } else {
      let host = p.origin;
      try {
        host = new URL(p.origin).host;
      } catch {}
      const what = p.kinds.map((k) => t(`perm.${k}`)).join(', ');
      bar.querySelector('.info-icon').innerHTML = icon(PERM_ICONS[p.kinds[0]] || 'info', 17);
      bar.querySelector('.info-text').innerHTML = `<b>${esc(host)}</b> ${esc(t('perm.wants', { what }))}`;
      bar.dataset.tab = tab.id;
      bar.hidden = false;
    }
    if (wasHidden !== bar.hidden) reportBounds();
  }
  $('#infobar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    api.send('perm:respond', Number($('#infobar').dataset.tab), act === 'allow');
  });

  // ------------------------------------------------------------------ find bar
  const findInput = $('#find-input');
  let findOpen = false;
  function openFind() {
    const bar = $('#findbar');
    if (bar.hidden) {
      bar.hidden = false;
      reportBounds();
    }
    findOpen = true;
    findInput.focus();
    findInput.select();
    if (findInput.value) api.send('find:query', findInput.value, { forward: true, newSession: true });
  }
  function closeFind(refocus = true) {
    if (!findOpen) return;
    findOpen = false;
    $('#findbar').hidden = true;
    $('#find-count').textContent = '';
    findInput.classList.remove('nomatch');
    api.send('find:stop');
    reportBounds();
    if (refocus) api.send('ui:command', 'focus-page');
  }
  function findStep(forward) {
    if (!findOpen) return openFind();
    if (findInput.value) api.send('find:query', findInput.value, { forward, newSession: false });
  }
  findInput.addEventListener('input', () => {
    api.send('find:query', findInput.value, { forward: true, newSession: true });
    if (!findInput.value) {
      $('#find-count').textContent = '';
      findInput.classList.remove('nomatch');
    }
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findStep(!e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('#find-prev').addEventListener('click', () => findStep(false));
  $('#find-next').addEventListener('click', () => findStep(true));
  $('#find-close').addEventListener('click', () => closeFind());

  // ------------------------------------------------------------------ split view
  function renderSplit() {
    const sp = state.split;
    const ringL = $('#split-ring-l');
    const ringR = $('#split-ring-r');
    const divider = $('#split-divider');
    const show = !!sp && !htmlFullscreen;
    ringL.hidden = ringR.hidden = divider.hidden = !show;
    if (!show) return;
    const area = $('#page-area');
    const inset = 4;
    const gap = 8;
    const width = area.clientWidth - inset * 2;
    const height = area.clientHeight - inset * 2;
    const lw = Math.round((width - gap) * state.splitRatio);
    Object.assign(ringL.style, { left: `${inset}px`, top: `${inset}px`, width: `${lw}px`, height: `${height}px` });
    Object.assign(ringR.style, { left: `${inset + lw + gap}px`, top: `${inset}px`, width: `${width - lw - gap}px`, height: `${height}px` });
    Object.assign(divider.style, { left: `${inset + lw}px`, top: `${inset}px`, height: `${height}px` });
    ringL.classList.toggle('focused', state.activeId === sp.left);
    ringR.classList.toggle('focused', state.activeId === sp.right);
  }

  {
    const divider = $('#split-divider');
    let dragging = false;
    let raf = 0;
    divider.addEventListener('pointerdown', (e) => {
      dragging = true;
      divider.classList.add('dragging');
      divider.setPointerCapture(e.pointerId);
    });
    divider.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = $('#page-area').getBoundingClientRect();
      const width = r.width - 8;
      const ratio = Math.min(0.8, Math.max(0.2, (e.clientX - r.left - 4 - 4) / (width - 8)));
      state.splitRatio = ratio;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        renderSplit();
        api.send('split:ratio', ratio);
      });
    });
    const stop = () => {
      dragging = false;
      divider.classList.remove('dragging');
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('dblclick', () => {
      state.splitRatio = 0.5;
      renderSplit();
      api.send('split:ratio', 0.5);
    });
  }

  // ------------------------------------------------------------------ page area bounds
  const pageArea = $('#page-area');
  let boundsRaf = 0;
  function reportBounds() {
    cancelAnimationFrame(boundsRaf);
    boundsRaf = requestAnimationFrame(() => {
      const r = pageArea.getBoundingClientRect();
      api.send('ui:bounds', { x: r.left, y: r.top, width: r.width, height: r.height });
      renderSplit();
      updateNarrow();
    });
  }
  new ResizeObserver(reportBounds).observe(pageArea);
  window.addEventListener('resize', reportBounds);

  function setFullscreen() {
    document.body.classList.toggle('fullscreen', winFullscreen || htmlFullscreen);
    document.body.classList.toggle('fullscreen-native', winFullscreen);
    reportBounds();
  }

  // ------------------------------------------------------------------ downloads & update
  function renderDownloads() {
    const btn = $('#btn-downloads');
    if (downloads.hasDownloads) btn.hidden = false;
    btn.classList.toggle('active', downloads.count > 0);
    btn.classList.toggle('indeterminate', downloads.count > 0 && downloads.fraction < 0);
    btn.style.setProperty('--p', String(Math.max(0, downloads.fraction)));
  }

  function renderUpdate() {
    $('#btn-menu .dot').hidden = update?.state !== 'ready';
  }

  // ------------------------------------------------------------------ drag & drop links
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (text) api.send('nav:go', text, { disposition: 'new-tab' });
  });

  // ------------------------------------------------------------------ messages from main
  api.on('state:init', (init) => {
    settings = init.settings;
    lang = init.lang;
    bookmarks = init.bookmarks;
    downloads = { ...init.downloads, hasDownloads: false };
    update = init.update;
    winFullscreen = !!init.fullscreen;
    applySettings();
    applyStrings();
    renderDownloads();
    renderUpdate();
    setFullscreen();
    reportBounds();
  });
  api.on('state:tabs', (s) => {
    state = s;
    render();
  });
  api.on('state:settings', (s) => {
    settings = s;
    applySettings();
  });
  api.on('state:lang', (l) => {
    lang = l;
    applyStrings();
  });
  api.on('state:theme', () => applyTheme());
  api.on('state:bookmarks', (list) => {
    bookmarks = list;
    renderBookmarks();
  });
  api.on('state:downloads', (d) => {
    downloads = d;
    renderDownloads();
  });
  api.on('state:update', (u) => {
    update = u;
    renderUpdate();
  });
  api.on('state:find', (r) => {
    const count = $('#find-count');
    if (!r || !findInput.value) {
      count.textContent = '';
      findInput.classList.remove('nomatch');
      return;
    }
    count.textContent = t('find.count', { active: r.total ? r.active : 0, total: r.total });
    findInput.classList.toggle('nomatch', r.total === 0);
  });
  api.on('win:focus', (focused) => document.body.classList.toggle('inactive', !focused));
  api.on('win:fullscreen', (on) => {
    winFullscreen = on;
    setFullscreen();
  });
  api.on('ui:html-fullscreen', (on) => {
    htmlFullscreen = on;
    setFullscreen();
  });
  api.on('ui:focus-omnibox', (opts) => {
    urlInput.focus();
    urlInput.select();
    if (opts?.recent && !userTyped) showRecent();
  });
  api.on('ui:find', () => openFind());
  api.on('ui:find-step', ({ forward }) => findStep(forward));
  api.on('ui:bookmark-page', () => {
    const star = $('#btn-star');
    if (!star.hidden) togglePopup('bookmark', star);
  });
  api.on('ui:palette', () => {
    if (popupOpen === 'palette') return api.send('popup:close', 'palette');
    closeSuggest();
    const top = document.querySelector('#toolbar').getBoundingClientRect().bottom;
    api.send('popup:open', 'palette', { x: 0, y: top, width: window.innerWidth, height: 0, align: 'center', gap: 6 }, {});
    popupOpen = 'palette';
  });
  api.on('ui:open-popup', ({ type }) => {
    const map = { shields: '#btn-shields', menu: '#btn-menu', downloads: '#btn-downloads' };
    if (map[type]) togglePopup(type, $(map[type]));
  });
  api.on('ui:popup-closed', ({ type }) => {
    if (popupOpen === type) popupOpen = null;
    if (type === 'suggest') suggest.open = false;
    lastPopupClose = { type, time: Date.now() };
    updatePopupButtons();
  });
  api.on('omnibox:pick', (p) => pickSuggestion(p));
  api.on('omnibox:remove', (p) => removeSuggestion(p));
  api.on('ui:attention', (tabId) => {
    attention.add(tabId);
    render();
  });
  api.on('ui:download-started', () => {
    downloads.hasDownloads = true;
    renderDownloads();
    const btn = $('#btn-downloads');
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  });

  api.send('ui:ready');
})();
