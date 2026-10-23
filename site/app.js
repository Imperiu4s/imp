'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ------------------------------------------------------------------ icons
  const svg = (body, fill = false) =>
    `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const ICONS = {
    shield: svg('<path d="M12 3l7.5 2.8v5.9c0 4.6-3.2 8.3-7.5 9.3-4.3-1-7.5-4.7-7.5-9.3V5.8z"/><path d="M8.8 12.2l2.3 2.3 4.3-4.6"/>'),
    moon: svg('<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>'),
    split: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15"/>'),
    sidebar: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>'),
    command: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.5-3 2.5"/><path d="M12.5 15h4"/>'),
    book: svg('<path d="M3.5 5.5c2.5-1 5.3-.7 8.5 1.2 3.2-1.9 6-2.2 8.5-1.2v13c-2.5-1-5.3-.7-8.5 1.2-3.2-1.9-6-2.2-8.5-1.2z"/><path d="M12 6.7v12.5"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    camera: svg('<path d="M4 8h3l1.8-2.5h6.4L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
    zap: svg('<path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>'),
    incognito: svg('<path d="M3 11.5h18"/><path d="M5.5 11.5L7.5 5h9l2 6.5"/><circle cx="7.5" cy="16" r="2.6"/><circle cx="16.5" cy="16" r="2.6"/><path d="M10.1 16h3.8"/>'),
    download: svg('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
    refresh: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8.5"/><path d="M20.5 3.5v5h-5"/>'),
    windows: svg('<path d="M3 5.5l7.5-1v7H3zM12 4.3L21 3v8.5h-9zM3 12.5h7.5v7L3 18.5zM12 12.5h9V21l-9-1.3z"/>', true),
    apple: svg('<path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z"/>', true),
    linux: svg('<path d="M12 3c-2.2 0-3.4 1.9-3.4 4.4 0 1.4.4 2.3-.6 3.7-1.2 1.6-2.6 3.6-2.6 5.6 0 .9.3 1.6.8 2.1-.5.4-1 .9-.8 1.5.3.9 2 .8 3.3 1.1 1 .2 1.6.6 2.4.6h2.6c.8 0 1.4-.4 2.4-.6 1.3-.3 3-.2 3.3-1.1.2-.6-.3-1.1-.8-1.5.5-.5.8-1.2.8-2.1 0-2-1.4-4-2.6-5.6-1-1.4-.6-2.3-.6-3.7C15.4 4.9 14.2 3 12 3z"/><circle cx="10.5" cy="7.5" r=".9" fill="#070a17"/><circle cx="13.5" cy="7.5" r=".9" fill="#070a17"/>', true),
  };
  $$('[data-icon]').forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || '';
  });

  // ------------------------------------------------------------------ translations
  const EN = {
    'nav.features': 'Features',
    'nav.best': 'Best of all',
    'nav.speed': 'Speed',
    'nav.faq': 'FAQ',
    'nav.download': 'Download',
    'hero.pill': 'Free and ad-free',
    'hero.title': 'The browser that <span class="grad">stays fast.</span>',
    'hero.lead': 'Imp blocks ads and trackers before they load, puts unused tabs to sleep and stays light on any computer. We gathered the best ideas from every browser — in one place.',
    'hero.download': 'Download for Windows',
    'hero.other': 'Other platforms',
    'hero.meta': 'Chromium engine · Windows, macOS, Linux',
    'mock.newTab': 'New Tab',
    'mock.search': 'Search or type a web address',
    'mock.engine': 'Search or type a URL',
    'mock.blocked': 'ads & trackers blocked',
    'mock.saved': 'time saved',
    'mock.savedVal': '10 min',
    'mock.shieldsUp': 'Shields: UP',
    'mock.shieldsSub': '34 items blocked on this page',
    'mock.sleeping': '5 tabs sleeping',
    'mock.sleepingSub': 'memory freed',
    'strip.1': 'Built-in Shields',
    'strip.1d': 'ad & tracker blocker',
    'strip.2': 'Sleeping tabs',
    'strip.2d': 'less RAM and CPU',
    'strip.3': 'Lazy session restore',
    'strip.3d': 'fast startup even with many tabs',
    'strip.4': 'English & Hungarian',
    'strip.4d': 'fully translated',
    'feat.title': 'Everything a modern browser needs',
    'feat.lead': 'And nothing that slows it down.',
    'f.shields': 'Imp Shields',
    'f.shieldsD': 'Blocks ads, trackers, crypto miners and — in aggressive mode — cookie banners. Turn it off per site with one click.',
    'f.sleep': 'Sleeping tabs',
    'f.sleepD': 'Tabs you haven’t used for a while go to sleep and free their memory; they wake up with scroll position and history intact.',
    'f.split': 'Split view',
    'f.splitD': 'Two tabs side by side in one window, with a draggable divider.',
    'f.vertical': 'Vertical tabs',
    'f.verticalD': 'Tabs in a collapsible sidebar — perfect when you keep many open.',
    'f.palette': 'Quick commands',
    'f.paletteD': 'Ctrl+Shift+A: search your tabs, bookmarks, history and every command.',
    'f.reader': 'Reader mode',
    'f.readerD': 'Clean, ad-free articles with adjustable text size, sepia and dark themes.',
    'f.https': 'HTTPS upgrades & secure DNS',
    'f.httpsD': 'Automatic encrypted connections, DNS-over-HTTPS, Global Privacy Control and third-party cookie blocking.',
    'f.capture': 'Web capture & translate',
    'f.captureD': 'Save the visible area or the whole page with one click, and translate pages from the context menu.',
    'f.task': 'Task manager',
    'f.taskD': 'See how much memory and CPU each tab uses — then sleep or close it with a click.',
    'f.private': 'Private windows',
    'f.privateD': 'Each private window gets its own in-memory session; everything is wiped when you close it.',
    'f.import': 'Easy switching',
    'f.importD': 'Import bookmarks from Chrome, Edge, Brave, Vivaldi, Opera or an HTML file.',
    'f.update': 'Automatic updates',
    'f.updateD': 'Imp updates itself in the background, finished with one restart.',
    'best.title': 'The best ideas from every browser',
    'best.lead': 'We didn’t reinvent the wheel — we put together what the others do best.',
    'b.brave': 'Built-in Shields with stats on the New Tab page',
    'b.edge': 'Sleeping tabs, efficiency mode, split screen',
    'b.vivaldi': 'Quick commands and vertical tabs',
    'b.firefox': 'Reader view and HTTPS-only mode',
    'b.opera': 'Built-in screenshot tool',
    'b.chrome': 'Smart address bar, task manager, tab management',
    'b.arc': 'Command-bar style quick navigation',
    'b.safari': 'A calm, content-first interface',
    'speed.title': 'Fast even on older PCs',
    'speed.lead': 'Speed isn’t one trick — it’s many small decisions:',
    'speed.1': '<b>Less to download:</b> ads and trackers never load, so pages are ready sooner.',
    'speed.2': '<b>Less memory:</b> background tabs go to sleep — even sooner on battery.',
    'speed.3': '<b>Quick startup:</b> when restoring, only the active tab loads; the rest load when you open them.',
    'speed.4': '<b>Preconnect:</b> while you pick a suggestion, Imp is already connecting to the site.',
    'speed.5': '<b>Light interface:</b> framework-free, native HTML/CSS browser UI.',
    'speed.6': '<b>Made for old machines too:</b> hardware acceleration can be switched off, and the task manager shows what slows you down.',
    'meter.requests': 'Network requests on a news site',
    'meter.without': 'Without blocking',
    'meter.with': 'Imp Shields',
    'meter.note': 'Illustration only — real savings differ per site. Imp Shields shows your own numbers.',
    'dl.title': 'Get Imp',
    'dl.lead': 'Free. No account, no sign-up.',
    'dl.win': 'Windows 10 and 11, 64-bit',
    'dl.winBtn': 'Download installer (.exe)',
    'dl.mac': 'macOS 12 or later',
    'dl.macArm': 'Apple Silicon (.dmg)',
    'dl.macIntel': 'Intel (.dmg)',
    'dl.linux': 'Ubuntu, Debian, Fedora and more',
    'dl.appimage': 'AppImage',
    'dl.deb': '.deb package',
    'dl.version': 'Latest version: {v} · released {d}',
    'faq.title': 'Frequently asked questions',
    q1: 'Is it really free?',
    a1: 'Yes. Imp is completely free, has no ads and collects no data about you.',
    q2: 'What engine does it use?',
    a2: 'Chromium (through Electron) — the same engine as Chrome, Edge and Brave, so websites work just like in those browsers.',
    q3: 'Why does Windows show a warning during install?',
    a3: 'The installer isn’t digitally signed yet (that requires a paid certificate). Click “More info” and then “Run anyway”.',
    q4: 'Do Chrome extensions work?',
    a4: 'Not yet — the built-in Shields replace the most popular extension, the ad blocker. Extension support is on the roadmap.',
    q5: 'How does it update?',
    a5: 'Automatically: Imp downloads the new version in the background and installs it on the next restart.',
    q6: 'Where is my data stored?',
    a6: 'Only on your own computer, in your profile folder. No account, no cloud sync, no telemetry.',
    'footer.tag': 'Fast. Private. Light.',
    'footer.trademarks': 'Browser names mentioned are trademarks of their owners; Imp is not affiliated with them.',
    'main.win': 'Download for Windows',
    'main.winSub': 'Windows 10 / 11 · 64-bit',
    'main.mac': 'Download for macOS',
    'main.macSub': 'Apple Silicon & Intel',
    'main.linux': 'Download for Linux',
    'main.linuxSub': 'AppImage · .deb',
  };
  const HU_EXTRA = {
    'dl.version': 'Legújabb verzió: {v} · kiadva: {d}',
    'main.win': 'Letöltés Windowsra',
    'main.winSub': 'Windows 10 / 11 · 64 bit',
    'main.mac': 'Letöltés macOS-re',
    'main.macSub': 'Apple Silicon és Intel',
    'main.linux': 'Letöltés Linuxra',
    'main.linuxSub': 'AppImage · .deb',
  };

  // Hungarian is written in the HTML itself; capture it so we can switch back.
  const HU = { ...HU_EXTRA };
  $$('[data-i18n]').forEach((el) => (HU[el.dataset.i18n] = el.textContent));
  $$('[data-i18n-html]').forEach((el) => (HU[el.dataset.i18nHtml] = el.innerHTML));

  const saved = (() => {
    try {
      return localStorage.getItem('imp-site-lang');
    } catch {
      return null;
    }
  })();
  let lang = saved || (/^hu\b/i.test(navigator.language || '') ? 'hu' : 'en');
  const t = (key, vars) => {
    let s = (lang === 'hu' ? HU : EN)[key] ?? EN[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
    return s;
  };

  // ------------------------------------------------------------------ OS detection
  function detectOS() {
    const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    if (p.includes('win') || ua.includes('windows')) return 'windows';
    if (p.includes('mac') || ua.includes('mac os')) return /iphone|ipad/.test(ua) ? 'other' : 'mac';
    if (p.includes('linux') || ua.includes('linux')) return /android/.test(ua) ? 'other' : 'linux';
    return 'other';
  }
  const os = detectOS();

  // ------------------------------------------------------------------ releases
  function detectRepo() {
    const configured = (window.IMP_CONFIG && window.IMP_CONFIG.repo) || '';
    if (/^[\w.-]+\/[\w.-]+$/.test(configured)) return configured;
    const host = location.hostname;
    if (host.endsWith('.github.io')) {
      const owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      return `${owner}/${first || `${owner}.github.io`}`;
    }
    return '';
  }
  const repo = detectRepo();
  const releasesUrl = repo ? `https://github.com/${repo}/releases/latest` : '#download';
  const assets = { windows: null, macArm: null, macX64: null, appimage: null, deb: null };
  let release = null;

  async function loadRelease() {
    if (!repo) return;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      release = await res.json();
      for (const a of release.assets || []) {
        const n = a.name;
        if (/\.blockmap$|\.yml$/.test(n)) continue;
        if (/Setup.*\.exe$/i.test(n)) assets.windows = a;
        else if (/arm64\.dmg$/i.test(n)) assets.macArm = a;
        else if (/(x64|x86_64)\.dmg$/i.test(n)) assets.macX64 = a;
        else if (/\.AppImage$/i.test(n)) assets.appimage = a;
        else if (/\.deb$/i.test(n)) assets.deb = a;
      }
      render();
    } catch {
      /* offline or rate-limited: buttons keep pointing at the releases page */
    }
  }

  const mb = (a) => (a ? ` · ${Math.round(a.size / 1048576)} MB` : '');

  function setLink(el, asset) {
    if (!el) return;
    el.href = asset ? asset.browser_download_url : releasesUrl;
    el.classList.toggle('disabled', !asset && !!release);
  }

  function render() {
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $$('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    $('#lang').textContent = lang === 'hu' ? 'EN' : 'HU';
    document.title = lang === 'hu' ? 'Imp — gyors, privát, könnyű böngésző' : 'Imp — the fast, private, lightweight browser';


    setLink($('#dl-win'), assets.windows);
    setLink($('#dl-mac-arm'), assets.macArm);
    setLink($('#dl-mac-x64'), assets.macX64);
    setLink($('#dl-appimage'), assets.appimage);
    setLink($('#dl-deb'), assets.deb);

    const main = $('#dl-main');
    const label = $('#dl-main-label');
    const sub = $('#dl-main-sub');
    const osIcon = $('#os-icon');
    if (os === 'mac') {
      label.textContent = t('main.mac');
      sub.textContent = t('main.macSub');
      osIcon.innerHTML = ICONS.apple;
      // Apple Silicon vs Intel can't be detected reliably, so let people pick below.
      main.href = '#download';
    } else if (os === 'linux') {
      label.textContent = t('main.linux');
      sub.textContent = t('main.linuxSub') + mb(assets.appimage);
      osIcon.innerHTML = ICONS.linux;
      main.href = assets.appimage ? assets.appimage.browser_download_url : '#download';
    } else {
      label.textContent = t('main.win');
      sub.textContent = t('main.winSub') + mb(assets.windows);
      osIcon.innerHTML = ICONS.windows;
      main.href = assets.windows ? assets.windows.browser_download_url : repo ? releasesUrl : '#download';
    }
    $$('.dl-card').forEach((c) => c.classList.toggle('current', c.dataset.os === os));

    if (release) {
      const v = release.tag_name.replace(/^v/, '');
      const d = new Date(release.published_at).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      $('#dl-version').textContent = t('dl.version', { v, d });
      $('#version-line').textContent = `v${v} · ${t('hero.meta')}`;
    }
  }

  $('#lang').addEventListener('click', () => {
    lang = lang === 'hu' ? 'en' : 'hu';
    try {
      localStorage.setItem('imp-site-lang', lang);
    } catch {}
    render();
  });

  render();
  loadRelease();
})();
