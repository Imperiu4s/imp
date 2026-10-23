'use strict';
(async () => {
  const { t, call, esc, icon, toast } = window.Page;
  const $ = (s) => document.querySelector(s);
  const steps = [...document.querySelectorAll('.step')];
  const ACCENTS = ['#8B5CF6', '#E0337E', '#5B6CFF', '#0EA5E9', '#EC4899', '#F97316', '#10B981'];
  let step = 0;
  let S = await window.Page.init();
  const imports = await call('bookmarks.importSources');

  const set = (key, value) => call('settings.set', key, value);
  const choice = (attrs, inner, on) => `<button class="choice ${on ? 'on' : ''}" ${attrs}>${inner}</button>`;

  function renderChoices() {
    $('#themes').innerHTML = ['system', 'light', 'dark']
      .map((v) => choice(`data-key="appearance.theme" data-value="${v}"`, `<div class="preview ${v}"><div class="p-top"></div><div class="p-body"></div></div>${esc(t(`set.theme.${v}`))}`, S.appearance.theme === v))
      .join('');
    $('#accents').innerHTML = ACCENTS.map(
      (c) => `<button class="swatch ${S.appearance.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" data-key="appearance.accent" data-value="${c}"></button>`,
    ).join('');
    $('#layouts').innerHTML = [
      [false, 'window', 'set.tabs.horizontal', 'wel.horizontalDesc'],
      [true, 'sidebar', 'set.tabs.vertical', 'wel.verticalDesc'],
    ]
      .map(([v, ic, l, d]) => choice(`data-key="appearance.verticalTabs" data-value="${v}" data-type="bool"`, `${icon(ic, 24)}${esc(t(l))}<span class="desc">${esc(t(d))}</span>`, S.appearance.verticalTabs === v))
      .join('');
    $('#engines').innerHTML = Object.entries(window.ImpEngines)
      .map(([id, e]) => choice(`data-key="search.engine" data-value="${id}"`, `<span class="logo" style="background:${e.color}">${esc(e.name[0])}</span>${esc(e.name)}`, S.search.engine === id))
      .join('');
    $('#shields').innerHTML = [
      ['standard', 'shieldCheck', 'set.ab.standard', 'set.ab.standard.desc'],
      ['aggressive', 'shield', 'set.ab.aggressive', 'set.ab.aggressive.desc'],
      ['off', 'shieldOff', 'set.ab.off', 'set.ab.off.desc'],
    ]
      .map(([v, ic, l, d]) => choice(`data-key="shields.adblock" data-value="${v}"`, `${icon(ic, 26)}${esc(t(l))}<span class="desc">${esc(t(d))}</span>`, S.shields.adblock === v))
      .join('');
    const names = { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave', vivaldi: 'Vivaldi', opera: 'Opera' };
    $('#imports').innerHTML =
      imports.map((b) => choice(`data-import="${b}"`, `${icon('bookmark', 24)}${esc(names[b] || b)}`)).join('') +
      choice('data-import-html="1"', `${icon('file', 24)}${esc(t('set.import.html'))}`);
  }

  function show(i) {
    step = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, n) => (s.hidden = n !== step));
    $('#dots').innerHTML = steps.map((_, n) => `<i class="${n === step ? 'on' : ''}"></i>`).join('');
    $('#nav-row').hidden = step === 0 || step === steps.length - 1;
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.classList.contains('next') || el.id === 'next') return show(step + 1);
    if (el.id === 'back') return show(step - 1);
    if (el.dataset.key) {
      const v = el.dataset.type === 'bool' || el.dataset.value === 'true' || el.dataset.value === 'false' ? el.dataset.value === 'true' : el.dataset.value;
      await set(el.dataset.key, v);
      return;
    }
    if (el.dataset.import) {
      try {
        const n = await call('bookmarks.importBrowser', el.dataset.import);
        $('#import-result').textContent = t('set.import.done', { n });
        el.classList.add('on');
      } catch {
        toast(t('set.import.failed'));
      }
      return;
    }
    if (el.dataset.importHtml) {
      const n = await call('bookmarks.importHtml');
      if (n >= 0) $('#import-result').textContent = t('set.import.done', { n });
      return;
    }
    if (el.id === 'make-default') {
      await call('app.setDefault');
      return;
    }
    if (el.id === 'finish') {
      location.href = 'imp://newtab/';
    }
  });

  window.Page.onSettings((s) => {
    S = s;
    renderChoices();
  });

  renderChoices();
  show(0);
  // Closing this tab early just keeps the defaults; don't show the wizard again.
  call('welcome.done');
})();
