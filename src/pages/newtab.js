'use strict';
(async () => {
  const { t, call, esc, icon, hostOf, fixImages } = window.Page;
  const $ = (s) => document.querySelector(s);
  const BACKGROUNDS = ['ember', 'aurora', 'sunset', 'ocean', 'forest', 'mono', 'none'];
  let data = null;

  const settings = await window.Page.init();

  // ---- clock ---------------------------------------------------------------------
  function tick() {
    const now = new Date();
    $('#time').textContent = now.toLocaleTimeString(window.Page.lang, { hour: '2-digit', minute: '2-digit' });
    $('#date').textContent = now.toLocaleDateString(window.Page.lang, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  tick();
  setInterval(tick, 15000);

  // ---- search ----------------------------------------------------------------------
  const q = $('#q');
  function placeholder() {
    const engine = window.ImpEngines[window.Page.settings.search.engine] || window.ImpEngines.duckduckgo;
    q.placeholder = t('ntp.searchPlaceholder', { engine: engine.name });
  }
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    const engine = window.ImpEngines[window.Page.settings.search.engine] || window.ImpEngines.duckduckgo;
    const looksUrl = /^[a-z]+:\/\//i.test(text) || (/^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(text) && !/\s/.test(text));
    location.href = looksUrl ? (/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`) : engine.search.replace('%s', encodeURIComponent(text));
  });

  // ---- tiles -------------------------------------------------------------------------
  const DEFAULT_SITES = [
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
    { title: 'GitHub', url: 'https://github.com/' },
    { title: 'Reddit', url: 'https://www.reddit.com/' },
    { title: 'Gmail', url: 'https://mail.google.com/' },
    { title: 'Maps', url: 'https://www.openstreetmap.org/' },
  ];

  function colorFor(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 62% 52%)`;
  }

  function tile(site, removable) {
    const host = hostOf(site.url);
    const name = site.title && site.title.length < 40 ? site.title : host;
    const letter = (name || host || '?').trim().charAt(0).toUpperCase();
    const ic = site.favicon
      ? `<img src="${esc(site.favicon)}" alt="" data-letter="${esc(letter)}">`
      : `<img src="https://${esc(host)}/favicon.ico" alt="" data-letter="${esc(letter)}">`;
    return `<a class="tile" href="${esc(site.url)}" title="${esc(site.title || site.url)}" data-url="${esc(site.url)}" data-removable="${removable}">
      <span class="tile-ic">${ic}</span><span class="tile-name">${esc(name)}</span>
      <button class="tile-x" title="${esc(t('ntp.remove'))}">${icon('close', 13)}</button></a>`;
  }

  function renderTiles() {
    const box = $('#shortcuts');
    const custom = data.shortcuts.map((s) => ({ ...s, custom: true }));
    let auto = data.topSites;
    if (!custom.length && !auto.length) auto = DEFAULT_SITES.filter((s) => !window.Page.settings.newtab.hiddenSites.includes(s.url));
    const sites = [...custom, ...auto].slice(0, 11);
    box.innerHTML =
      sites.map((s) => tile(s, s.custom ? 'custom' : 'auto')).join('') +
      `<button class="tile add" id="add-tile"><span class="tile-ic">${icon('plus', 22)}</span><span class="tile-name">${esc(t('ntp.addShortcut'))}</span></button>`;
    box.querySelectorAll('.tile-ic img').forEach((img) => {
      img.addEventListener('error', () => {
        const wrap = img.parentElement;
        wrap.textContent = img.dataset.letter;
        wrap.style.background = colorFor(wrap.closest('.tile').dataset.url || '');
      });
    });
    box.querySelectorAll('.tile-x').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const a = btn.closest('.tile');
        if (a.dataset.removable === 'custom') await call('newtab.removeShortcut', a.dataset.url);
        else await call('newtab.hideSite', a.dataset.url);
        await load();
      }),
    );
    $('#add-tile').addEventListener('click', () => {
      $('#add-title').value = '';
      $('#add-url').value = '';
      $('#add-dialog').showModal();
    });
    fixImages(box);
  }

  $('#add-cancel').addEventListener('click', () => $('#add-dialog').close());
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let url = $('#add-url').value.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const ok = await call('newtab.addShortcut', { title: $('#add-title').value.trim(), url });
    if (ok) {
      $('#add-dialog').close();
      load();
    }
  });

  // ---- stats -------------------------------------------------------------------------
  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} ${t('unit.min')}`;
    const h = (m / 60).toFixed(m < 600 ? 1 : 0);
    return `${h} ${t('unit.hour')}`;
  }

  function renderStats() {
    const st = data.stats;
    $('#st-blocked').textContent = st.blocked.toLocaleString(window.Page.lang);
    // Estimate used by most privacy browsers: ~50 ms saved per blocked request.
    $('#st-time').textContent = fmtDuration(st.blocked * 50);
    $('#st-https').textContent = st.upgraded.toLocaleString(window.Page.lang);
  }

  // ---- background & visibility ------------------------------------------------------
  async function applyLayout() {
    const s = window.Page.settings.newtab;
    $('#clock').hidden = !s.showClock;
    $('#shortcuts').hidden = !s.showShortcuts;
    $('#stats').hidden = !s.showStats || !!data?.private;
    const bg = $('#bg');
    bg.className = `bg ${s.background}`;
    bg.style.backgroundImage = '';
    document.body.classList.toggle('photo', s.background === 'custom');
    if (s.background === 'custom') {
      const img = await call('newtab.customBackground');
      if (img) bg.style.backgroundImage = `url("${img}")`;
    }
    document.querySelectorAll('.panel .switch').forEach((sw) => {
      const [, key] = sw.dataset.key.split('.');
      sw.classList.toggle('on', !!s[key]);
    });
    document.querySelectorAll('#bg-grid button').forEach((b) => b.classList.toggle('on', b.dataset.bg === s.background));
    placeholder();
  }

  $('#bg-grid').innerHTML = BACKGROUNDS.map((b) => `<button data-bg="${b}"><div class="bg ${b}"></div><span data-i18n="ntp.bg.${b}"></span></button>`).join('');
  window.Page.applyI18n($('#bg-grid'));
  $('#bg-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bg]');
    if (b) call('settings.set', 'newtab.background', b.dataset.bg);
  });
  $('#bg-upload').addEventListener('click', async () => {
    const res = await call('newtab.chooseBackground');
    if (res === 'too-big') window.Page.toast(t('ntp.bgTooBig'));
  });
  document.querySelectorAll('.panel .switch').forEach((sw) =>
    sw.addEventListener('click', () => call('settings.set', sw.dataset.key, !sw.classList.contains('on'))),
  );
  $('#customize').addEventListener('click', () => ($('#panel').hidden = !$('#panel').hidden));
  $('#panel-close').addEventListener('click', () => ($('#panel').hidden = true));

  async function load() {
    data = await call('newtab.data');
    document.body.classList.toggle('private', !!data.private);
    $('#private-info').hidden = !data.private;
    if (data.private) $('#stats').hidden = true;
    renderTiles();
    renderStats();
  }

  window.Page.onSettings(() => {
    applyLayout();
    load();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });

  void settings;
  await applyLayout();
  await load();
})();
