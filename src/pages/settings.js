'use strict';
(async () => {
  const { t, call, esc, icon, toast } = window.Page;
  const $ = (s) => document.querySelector(s);
  const content = $('#content');
  let S = await window.Page.init();
  let info = await call('app.info');
  let lists = { permissions: [], shortcuts: [], imports: [], dlDir: '' };

  const SECTIONS = [
    { id: 'appearance', icon: 'sun' },
    { id: 'startup', icon: 'power' },
    { id: 'search', icon: 'search' },
    { id: 'shields', icon: 'shieldCheck' },
    { id: 'privacy', icon: 'lock' },
    { id: 'permissions', icon: 'key' },
    { id: 'performance', icon: 'zap' },
    { id: 'downloads', icon: 'download' },
    { id: 'shortcuts', icon: 'keyboard' },
    { id: 'system', icon: 'monitor' },
    { id: 'about', icon: 'info' },
  ];
  const ACCENTS = ['#8B5CF6', '#E0337E', '#5B6CFF', '#0EA5E9', '#EC4899', '#F97316', '#10B981', '#EF4444', '#64748B'];

  const get = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), S);
  const set = (key, value) => call('settings.set', key, value).catch((err) => toast(String(err.message || err)));

  // ---- control builders ---------------------------------------------------------------
  const textBlock = (label, desc) =>
    `<div class="text"><div class="label">${esc(t(label))}</div>${desc ? `<div class="desc">${esc(t(desc))}</div>` : ''}</div>`;

  const sw = (key, label, desc) =>
    `<div class="item">${textBlock(label, desc)}<button class="switch ${get(key) ? 'on' : ''}" data-switch="${key}" aria-label="${esc(t(label))}"></button></div>`;

  const select = (key, label, options, desc, type = 'string') =>
    `<div class="item">${textBlock(label, desc)}<select class="input" data-select="${key}" data-type="${type}">${options
      .map(([v, l]) => `<option value="${esc(v)}" ${String(get(key)) === String(v) ? 'selected' : ''}>${esc(l.startsWith('!') ? l.slice(1) : t(l))}</option>`)
      .join('')}</select></div>`;

  const segmented = (key, label, options, desc) =>
    `<div class="item">${textBlock(label, desc)}<div class="segmented">${options
      .map(([v, l, ic]) => `<button class="${String(get(key)) === String(v) ? 'on' : ''}" data-seg="${key}" data-value="${esc(v)}">${ic ? icon(ic, 15) : ''}${esc(t(l))}</button>`)
      .join('')}</div></div>`;

  const radios = (key, options) =>
    `<div class="item stack"><div class="radio-list">${options
      .map(
        ([v, l, d]) =>
          `<button class="radio ${String(get(key)) === String(v) ? 'on' : ''}" data-seg="${key}" data-value="${esc(v)}"><span class="bullet"></span><span><div class="r-label">${esc(t(l))}</div>${d ? `<div class="r-desc">${esc(t(d))}</div>` : ''}</span></button>`,
      )
      .join('')}</div></div>`;

  const section = (id, body, introKey) => {
    const meta = SECTIONS.find((s) => s.id === id);
    return `<section class="section" id="${id}"><h2>${icon(meta.icon, 22)}${esc(t(`set.sec.${id}`))}</h2>${introKey ? `<p class="intro">${esc(t(introKey))}</p>` : ''}${body}</section>`;
  };

  // ---- sections -------------------------------------------------------------------------
  const R = {
    appearance: () =>
      section(
        'appearance',
        `<div class="group">
          ${segmented('appearance.theme', 'set.theme', [
            ['system', 'set.theme.system', 'monitor'],
            ['light', 'set.theme.light', 'sun'],
            ['dark', 'set.theme.dark', 'moon'],
          ])}
          <div class="item">${textBlock('set.accent')}<div class="swatches">${ACCENTS.map(
            (c) => `<button class="swatch ${get('appearance.accent').toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-accent="${c}" title="${c}"></button>`,
          ).join('')}<label class="swatch custom" title="${esc(t('set.accentCustom'))}"><input type="color" id="accent-custom" value="${esc(get('appearance.accent'))}"></label></div></div>
          ${segmented(
            'appearance.verticalTabs',
            'set.tabLayout',
            [
              ['false', 'set.tabs.horizontal', 'window'],
              ['true', 'set.tabs.vertical', 'sidebar'],
            ],
            'set.tabLayout.desc',
          )}
          ${select('appearance.bookmarksBar', 'set.bookmarksBar', [
            ['always', 'set.bb.always'],
            ['ntp', 'set.bb.ntp'],
            ['never', 'set.bb.never'],
          ])}
          ${sw('appearance.showHomeButton', 'set.homeButton')}
          ${sw('appearance.compact', 'set.compact', 'set.compact.desc')}
          ${select('appearance.language', 'set.language', [
            ['auto', 'set.lang.auto'],
            ['en', '!English'],
            ['hu', '!Magyar'],
          ])}
        </div>`,
      ),

    startup: () =>
      section(
        'startup',
        `<div class="group">
          ${radios('startup.mode', [
            ['restore', 'set.startup.restore', 'set.startup.restore.desc'],
            ['newtab', 'set.startup.newtab'],
            ['home', 'set.startup.home'],
          ])}
          <div class="item">${textBlock('set.homepage', 'set.homepage.desc')}<input class="input wide" id="homepage" value="${esc(get('startup.homepage'))}" spellcheck="false"></div>
        </div>`,
      ),

    search: () => {
      const engines = window.ImpEngines;
      return section(
        'search',
        `<div class="group">
          <div class="engines">${Object.entries(engines)
            .map(
              ([id, e]) =>
                `<button class="engine ${get('search.engine') === id ? 'on' : ''}" data-engine="${id}"><span class="dot" style="background:${e.color}">${esc(e.name[0])}</span>${esc(e.name)}</button>`,
            )
            .join('')}</div>
          ${sw('search.suggestions', 'set.suggestions', 'set.suggestions.desc')}
        </div>`,
        'set.search.intro',
      );
    },

    shields: () => {
      const allow = get('shields.allowlist');
      return section(
        'shields',
        `<div class="group">
          ${radios('shields.adblock', [
            ['standard', 'set.ab.standard', 'set.ab.standard.desc'],
            ['aggressive', 'set.ab.aggressive', 'set.ab.aggressive.desc'],
            ['off', 'set.ab.off', 'set.ab.off.desc'],
          ])}
          ${select(
            'shields.https',
            'set.https',
            [
              ['upgrade', 'set.https.upgrade'],
              ['strict', 'set.https.strict'],
              ['off', 'set.https.off'],
            ],
            'set.https.desc',
          )}
          ${sw('shields.thirdPartyCookies', 'set.3pc', 'set.3pc.desc')}
          ${sw('shields.gpc', 'set.gpc', 'set.gpc.desc')}
          <div class="item stack">${textBlock('set.allowlist', 'set.allowlist.desc')}
            <div class="chip-list">${
              allow.length
                ? allow.map((h) => `<span class="chip">${esc(h)}<button data-unallow="${esc(h)}" title="${esc(t('common.remove'))}">${icon('close', 12)}</button></span>`).join('')
                : `<span class="muted">${esc(t('set.allowlist.empty'))}</span>`
            }</div></div>
          <div class="item">${textBlock('set.shieldStats')}<div class="stat-row" id="shield-stats"></div><button class="btn small" id="reset-stats">${esc(t('set.resetStats'))}</button></div>
        </div>`,
        'set.shields.intro',
      );
    },

    privacy: () =>
      section(
        'privacy',
        `<div class="group">
          ${select(
            'privacy.dns',
            'set.dns',
            [
              ['automatic', 'set.dns.automatic'],
              ['cloudflare', '!Cloudflare (1.1.1.1)'],
              ['quad9', '!Quad9 (9.9.9.9)'],
              ['google', '!Google (8.8.8.8)'],
              ['custom', 'set.dns.custom'],
              ['off', 'set.dns.off'],
            ],
            'set.dns.desc',
          )}
          ${get('privacy.dns') === 'custom' ? `<div class="item">${textBlock('set.dns.customUrl')}<input class="input wide" id="dns-custom" placeholder="https://dns.example/dns-query" value="${esc(get('privacy.dnsCustom'))}" spellcheck="false"></div>` : ''}
          ${sw('privacy.saveHistory', 'set.saveHistory', 'set.saveHistory.desc')}
          ${sw('privacy.clearOnExit', 'set.clearOnExit', 'set.clearOnExit.desc')}
          <div class="item">${textBlock('set.clear.title', 'set.clear.desc')}<button class="btn" id="open-clear">${icon('trash', 15)}${esc(t('set.clear.open'))}</button></div>
        </div>`,
        'set.privacy.intro',
      ),

    permissions: () => {
      const KIND = (k) => t(`permName.${k}`);
      const rows = lists.permissions.length
        ? lists.permissions
            .map(
              (s) => `<div class="perm-site"><span class="fav">${icon('globe', 18)}</span><div class="grow"><div class="label">${esc(s.origin)}</div>
              <div class="perms">${Object.entries(s.perms)
                .map(([k, v]) => `<span class="tag ${v}">${esc(KIND(k))}: ${esc(t(`perm.${v}`))}</span>`)
                .join('')}</div></div>
              <button class="btn small" data-forget="${esc(s.origin)}">${esc(t('set.perm.reset'))}</button></div>`,
            )
            .join('')
        : `<div class="empty">${icon('key', 28)}${esc(t('set.perm.empty'))}</div>`;
      return section('permissions', `<div class="group">${rows}</div>`, 'set.permissions.intro');
    },

    performance: () =>
      section(
        'performance',
        `<div class="group">
          ${sw('performance.sleepingTabs', 'set.sleeping', 'set.sleeping.desc')}
          ${select(
            'performance.sleepAfter',
            'set.sleepAfter',
            [
              [5, '!5 min'],
              [15, '!15 min'],
              [30, '!30 min'],
              [60, '!1 h'],
              [120, '!2 h'],
              [240, '!4 h'],
            ],
            null,
            'number',
          )}
          ${select(
            'performance.efficiency',
            'set.efficiency',
            [
              ['auto', 'set.eff.auto'],
              ['on', 'set.eff.on'],
              ['off', 'set.eff.off'],
            ],
            'set.efficiency.desc',
          )}
          ${sw('performance.preconnect', 'set.preconnect', 'set.preconnect.desc')}
          ${sw('performance.hardwareAcceleration', 'set.hwaccel', 'set.hwaccel.desc')}
          <div class="item">${textBlock('set.taskManager', 'set.taskManager.desc')}<a class="btn" href="imp://performance/">${icon('zap', 15)}${esc(t('set.openTaskManager'))}</a></div>
          <div class="item">${textBlock('set.restart', 'set.restart.desc')}<button class="btn" id="relaunch">${icon('reload', 15)}${esc(t('set.restartNow'))}</button></div>
        </div>`,
        'set.performance.intro',
      ),

    downloads: () =>
      section(
        'downloads',
        `<div class="group">
          <div class="item"><div class="text"><div class="label">${esc(t('set.dl.location'))}</div><div class="desc">${esc(lists.dlDir)}</div></div>
            ${get('downloads.dir') ? `<button class="btn small" id="dl-reset">${esc(t('set.dl.reset'))}</button>` : ''}
            <button class="btn small" id="dl-change">${esc(t('set.dl.change'))}</button></div>
          ${sw('downloads.ask', 'set.dl.ask')}
        </div>`,
      ),

    shortcuts: () =>
      section(
        'shortcuts',
        `<div class="group"><table class="kbd-table">${lists.shortcuts
          .map((s) => `<tr><td>${esc(t(`sc.${s.name}`))}</td><td>${s.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</td></tr>`)
          .join('')}</table></div>`,
      ),

    system: () => {
      const names = { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera' };
      const importButtons = lists.imports.map((b) => `<button class="btn small" data-import="${b}">${esc(names[b] || b)}</button>`).join('');
      return section(
        'system',
        `<div class="group">
          <div class="item">${textBlock(info.isDefault ? 'set.default.yes' : 'set.default.no', 'set.default.desc')}
            <button class="btn ${info.isDefault ? '' : 'primary'}" id="make-default">${esc(t('set.default.button'))}</button></div>
          <div class="item stack">${textBlock('set.import', 'set.import.desc')}
            <div class="chip-list">${importButtons}<button class="btn small" id="import-html">${icon('file', 14)}${esc(t('set.import.html'))}</button>
            <button class="btn small" id="export-html">${icon('upload', 14)}${esc(t('set.export.html'))}</button></div></div>
          <div class="item">${textBlock('set.dataFolder', 'set.dataFolder.desc')}<button class="btn small" id="open-data">${esc(t('set.open'))}</button></div>
          <div class="item">${textBlock('set.reset', 'set.reset.desc')}<button class="btn small danger" id="reset-settings">${esc(t('set.reset.button'))}</button></div>
        </div>`,
      );
    },

    about: () => {
      const up = info.update;
      let upText = t(info.packaged ? 'set.update.idle' : 'set.update.dev');
      if (up?.state === 'checking') upText = t('set.update.checking');
      else if (up?.state === 'downloading') upText = t('set.update.downloading', { v: up.version || '', p: up.percent ?? 0 });
      else if (up?.state === 'ready') upText = t('set.update.ready', { v: up.version || '' });
      else if (up?.state === 'latest') upText = t('set.update.latest');
      else if (up?.state === 'error') upText = t('set.update.error');
      return section(
        'about',
        `<div class="group">
          <div class="about"><img src="/assets/icon.svg" width="72" height="72" alt="">
            <div><h3>Imp</h3><div class="muted">${esc(t('set.about.tagline'))}</div>
            <div class="versions">${esc(t('set.about.version'))} ${esc(info.version)} · Chromium ${esc(info.chrome)} · Electron ${esc(info.electron)} · ${esc(info.platform)}-${esc(info.arch)}</div></div></div>
          <div class="item">${`<div class="text"><div class="label">${esc(t('set.update'))}</div><div class="desc">${esc(upText)}</div></div>`}
            ${up?.state === 'ready' ? `<button class="btn primary" id="install-update">${esc(t('set.update.install'))}</button>` : `<button class="btn" id="check-update" ${info.packaged ? '' : 'disabled'}>${esc(t('set.update.check'))}</button>`}</div>
          <div class="item"><div class="text"><div class="label">${esc(t('set.about.credits'))}</div><div class="desc">${esc(t('set.about.creditsText'))}</div></div>
            ${info.homepage ? `<a class="btn small" href="${esc(info.homepage)}">${icon('code', 14)}GitHub</a>` : ''}</div>
        </div>`,
      );
    },
  };

  // ---- rendering ------------------------------------------------------------------------
  async function loadLists() {
    const [permissions, shortcuts, imports, dlDir] = await Promise.all([
      call('permissions.list'),
      call('shortcuts.list'),
      call('bookmarks.importSources'),
      call('downloads.dir'),
    ]);
    lists = { permissions, shortcuts, imports, dlDir };
  }

  async function renderStats() {
    const st = await call('shields.stats');
    const el = $('#shield-stats');
    if (!el) return;
    el.innerHTML = `<div><b>${st.blocked.toLocaleString(window.Page.lang)}</b><span class="muted">${esc(t('set.stats.blocked'))}</span></div>
      <div><b>${st.upgraded.toLocaleString(window.Page.lang)}</b><span class="muted">${esc(t('set.stats.upgraded'))}</span></div>`;
  }

  function renderNav() {
    $('#nav').innerHTML = SECTIONS.map((s) => `<a href="#${s.id}" data-nav="${s.id}">${icon(s.icon, 17)}<span>${esc(t(`set.sec.${s.id}`))}</span></a>`).join('');
  }

  function render() {
    const scroll = window.scrollY;
    content.innerHTML = SECTIONS.map((s) => R[s.id]()).join('');
    renderNav();
    renderStats();
    applyFilter();
    window.scrollTo(0, scroll);
    observeSections();
  }

  let observer = null;
  function observeSections() {
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === e.target.id));
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    content.querySelectorAll('.section').forEach((s) => observer.observe(s));
  }

  function applyFilter() {
    const q = $('#filter').value.trim().toLowerCase();
    content.querySelectorAll('.section').forEach((sec) => {
      let any = false;
      sec.querySelectorAll('.item, .perm-site, tr').forEach((it) => {
        const hit = !q || it.textContent.toLowerCase().includes(q);
        it.classList.toggle('hide-filter', !hit);
        any ||= hit;
      });
      const titleHit = sec.querySelector('h2').textContent.toLowerCase().includes(q);
      if (titleHit) sec.querySelectorAll('.hide-filter').forEach((el) => el.classList.remove('hide-filter'));
      sec.classList.toggle('hide-filter', !!q && !any && !titleHit);
    });
  }
  $('#filter').addEventListener('input', applyFilter);

  // ---- events (delegated) ---------------------------------------------------------------
  content.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-accent]');
    if (!el) return;
    if (el.dataset.switch) return set(el.dataset.switch, !get(el.dataset.switch));
    if (el.dataset.seg) {
      const raw = el.dataset.value;
      const current = get(el.dataset.seg);
      const value = typeof current === 'boolean' ? raw === 'true' : typeof current === 'number' ? Number(raw) : raw;
      return set(el.dataset.seg, value);
    }
    if (el.dataset.accent) return set('appearance.accent', el.dataset.accent);
    if (el.dataset.engine) return set('search.engine', el.dataset.engine);
    if (el.dataset.unallow) return set('shields.allowlist', get('shields.allowlist').filter((h) => h !== el.dataset.unallow));
    if (el.dataset.forget) {
      await call('permissions.clearSite', el.dataset.forget);
      await loadLists();
      return render();
    }
    if (el.dataset.import) {
      try {
        const n = await call('bookmarks.importBrowser', el.dataset.import);
        toast(t('set.import.done', { n }));
      } catch {
        toast(t('set.import.failed'));
      }
      return;
    }
    switch (el.id) {
      case 'reset-stats':
        await call('shields.resetStats');
        return renderStats();
      case 'open-clear':
        return $('#clear-dialog').showModal();
      case 'relaunch':
        return call('app.relaunch');
      case 'dl-change':
        if (await call('downloads.chooseDir')) {
          await loadLists();
          render();
        }
        return;
      case 'dl-reset':
        await set('downloads.dir', '');
        await loadLists();
        return render();
      case 'make-default':
        await call('app.setDefault');
        info = await call('app.info');
        return render();
      case 'import-html': {
        const n = await call('bookmarks.importHtml');
        if (n >= 0) toast(t('set.import.done', { n }));
        return;
      }
      case 'export-html':
        if (await call('bookmarks.exportHtml')) toast(t('set.export.done'));
        return;
      case 'open-data':
        return call('app.openDataFolder');
      case 'reset-settings':
        if (confirm(t('set.reset.confirm'))) await call('settings.reset');
        return;
      case 'check-update':
        await call('app.checkUpdate');
        info = await call('app.info');
        return render();
      case 'install-update':
        return call('app.installUpdate');
      default:
        return undefined;
    }
  });

  content.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.select) {
      const value = el.dataset.type === 'number' ? Number(el.value) : el.value;
      return set(el.dataset.select, value);
    }
    if (el.id === 'homepage') {
      let v = el.value.trim();
      if (v && !/^[a-z]+:/i.test(v)) v = `https://${v}`;
      return set('startup.homepage', v || 'imp://newtab');
    }
    if (el.id === 'dns-custom') {
      const v = el.value.trim();
      if (v && !/^https:\/\//.test(v)) return toast(t('set.dns.invalid'));
      return set('privacy.dnsCustom', v);
    }
    if (el.id === 'accent-custom') return set('appearance.accent', el.value);
    return undefined;
  });

  // clear data dialog
  $('#clear-cancel').addEventListener('click', () => $('#clear-dialog').close());
  $('#clear-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await call('data.clear', {
      range: $('#clear-range').value,
      history: $('#clear-history').checked,
      cookies: $('#clear-cookies').checked,
      cache: $('#clear-cache').checked,
      downloads: $('#clear-downloads').checked,
    });
    $('#clear-dialog').close();
    toast(t('set.clear.done'));
  });

  window.Page.onSettings((s) => {
    S = s;
    render();
  });
  window.Page.onEvent(async (type) => {
    if (type === 'update') {
      info = await call('app.info');
      render();
    }
  });

  await loadLists();
  render();
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) setTimeout(() => target.scrollIntoView(), 30);
  }
  window.addEventListener('hashchange', () => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }));
})();
