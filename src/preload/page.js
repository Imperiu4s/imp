'use strict';
// Runs in every tab. Only Imp's own imp:// pages get the privileged bridge;
// ordinary websites see nothing.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'imp:') {
  contextBridge.exposeInMainWorld('imp', {
    call: (method, ...args) => ipcRenderer.invoke('imp:api', method, args),
    on: (fn) => ipcRenderer.on('imp:event', (event, type, data) => fn(type, data)),
  });
}

// Faster link clicks: when the pointer rests on a link to another site (or
// presses it), open the connection to that site already, so the page starts
// loading 100–300 ms sooner. The main process skips this when "Preconnect to
// pages" is turned off.
if (/^https?:$/.test(location.protocol)) {
  const done = new Map();
  let hoverTimer = 0;
  const warm = (target) => {
    const a = target instanceof Element ? target.closest('a[href]') : null;
    if (!a || !/^https?:$/.test(a.protocol) || a.origin === location.origin) return;
    const now = Date.now();
    if (now - (done.get(a.origin) || 0) < 10_000) return;
    done.set(a.origin, now);
    ipcRenderer.send('imp:preconnect', a.origin);
  };
  addEventListener('pointerover', (e) => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => warm(e.target), 80);
  }, { passive: true, capture: true });
  addEventListener('pointerdown', (e) => warm(e.target), { passive: true, capture: true });
}

// Password manager (see src/main/autofill.js): notices sign-ins so Imp can offer
// to save the password, and fills a saved account when you pick it from the list
// that Imp shows under a login field. The page never gets a password by itself.
if (/^https?:$/.test(location.protocol)) {
  const TEXT_TYPES = new Set(['text', 'email', 'tel']);
  const USER_HINT = /user|login|e-?mail|account|ident|felhaszn|benutzer/i;
  const isInput = (el) => el instanceof HTMLInputElement;
  const isPassword = (el) => isInput(el) && el.type === 'password';
  const isText = (el) => isInput(el) && TEXT_TYPES.has(el.type);
  const shown = (el) => {
    if (!el.isConnected || el.disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
  };
  const scopeOf = (el) => el.form || el.closest('form') || document;
  const passwordsIn = (scope) => [...scope.querySelectorAll('input[type=password]')].filter(shown);
  const looksLikeUsername = (el) =>
    isText(el) && (/username|email/.test(el.autocomplete) || el.type === 'email' || USER_HINT.test(`${el.name} ${el.id}`));

  // The username field of a login form: the closest visible text field before the password.
  function usernameFor(pass) {
    const inputs = [...scopeOf(pass).querySelectorAll('input')];
    const before = inputs.slice(0, inputs.indexOf(pass)).filter((el) => isText(el) && shown(el));
    return before.findLast((el) => /username|email/.test(el.autocomplete)) || before.at(-1) || null;
  }

  // 'username' / 'password' for the fields of a sign-in form, otherwise null.
  function loginField(el) {
    if (isPassword(el)) return el.autocomplete === 'new-password' ? null : 'password';
    if (!isText(el) || !shown(el)) return null;
    const scope = scopeOf(el);
    const pass = passwordsIn(scope)[0];
    if (pass) return usernameFor(pass) === el ? 'username' : null;
    // First screen of a two-step sign-in: just the e-mail / username.
    const texts = [...scope.querySelectorAll('input')].filter((x) => isText(x) && shown(x));
    return texts.length <= 3 && looksLikeUsername(el) ? 'username' : null;
  }

  let hasLogins = null; // does this site have saved logins? (asked on first use)
  let asking = null;
  let current = null; // the field the list belongs to
  let listOpen = false;
  let listSelected = false;
  let lastUsername = '';
  let lastKeyWasTab = false;

  const siteHasLogins = () => {
    if (hasLogins !== null) return Promise.resolve(hasLogins);
    asking ||= ipcRenderer
      .invoke('imp:pw-has')
      .then((v) => (hasLogins = !!v))
      .catch(() => (hasLogins = false))
      .finally(() => (asking = null));
    return asking;
  };
  ipcRenderer.on('imp:pw-changed', () => (hasLogins = null));
  ipcRenderer.on('imp:pw-popup', (event, s) => {
    listOpen = !!s?.open;
    listSelected = !!s?.selected;
  });

  async function showList(el) {
    const field = loginField(el);
    if (!field || !(await siteHasLogins()) || document.activeElement !== el) return;
    current = el;
    const r = el.getBoundingClientRect();
    ipcRenderer.send('imp:pw-focus', { field, value: el.value, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
  }

  // A form was sent (or its button clicked): report the sign-in.
  let goneTimers = [];
  function capture(from) {
    const scope = (from instanceof Element && (from.form || from.closest('form'))) || document;
    let fields = passwordsIn(scope).filter((el) => el.value);
    if (!fields.length && scope !== document) fields = passwordsIn(document).filter((el) => el.value);
    if (!fields.length) {
      const user = [...scope.querySelectorAll('input')].find((el) => looksLikeUsername(el) && shown(el) && el.value.trim());
      if (user) {
        lastUsername = user.value.trim();
        ipcRenderer.send('imp:pw-username', lastUsername);
      }
      return;
    }
    // Sign-up and change-password forms: save the new password.
    const pass = fields.find((el) => el.autocomplete === 'new-password') || (fields.length === 3 ? fields[1] : fields[0]);
    const userEl = usernameFor(fields[0]);
    ipcRenderer.send('imp:pw-submit', { username: userEl?.value.trim() || lastUsername, password: pass.value });
    // Single-page apps sign in without loading a page: watch the form disappear.
    goneTimers.forEach(clearTimeout);
    goneTimers = [1200, 3000, 6000].map((ms) =>
      setTimeout(() => {
        if (shown(fields[0])) return;
        goneTimers.forEach(clearTimeout);
        ipcRenderer.send('imp:pw-gone');
      }, ms),
    );
  }

  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  function setValue(el, value) {
    valueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // After picking an account on the e-mail screen, fill its password on the next one.
  let refillAsked = false;
  let refillTimer = 0;
  function askRefill() {
    if (refillAsked || !passwordsIn(document).some((el) => !el.value)) return false;
    refillAsked = true;
    ipcRenderer.send('imp:pw-refill');
    return true;
  }
  function waitForPassword() {
    clearInterval(refillTimer);
    refillAsked = false;
    const until = Date.now() + 60_000;
    refillTimer = setInterval(() => {
      if (askRefill() || Date.now() > until) clearInterval(refillTimer);
    }, 400);
  }

  ipcRenderer.on('imp:pw-fill', (event, { username, password, passwordOnly }) => {
    const el = current?.isConnected ? current : null;
    let user = null;
    let pass = null;
    if (passwordOnly) pass = passwordsIn(document).find((x) => !x.value) || null;
    else if (el && isPassword(el)) {
      pass = el;
      user = usernameFor(el);
    } else if (el) {
      user = el;
      pass = passwordsIn(scopeOf(el))[0] || null;
    }
    if (user && username) setValue(user, username);
    if (pass) setValue(pass, password);
    if (username) lastUsername = username;
    if (!pass && !passwordOnly) waitForPassword();
  });

  addEventListener(
    'keydown',
    (e) => {
      lastKeyWasTab = e.key === 'Tab';
      const el = e.target;
      if (!e.isTrusted || !isInput(el)) return;
      if (listOpen && current === el && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ipcRenderer.send('imp:pw-key', e.key);
      } else if (listOpen && current === el && e.key === 'Enter' && listSelected) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ipcRenderer.send('imp:pw-key', 'Enter');
      } else if (e.key === 'ArrowDown' && !listOpen) {
        showList(el);
      } else if (e.key === 'Enter' && (isPassword(el) || isText(el))) {
        capture(el);
      }
    },
    true,
  );
  addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      if (isInput(e.target)) return void showList(e.target);
      const button = e.target.closest('button, input[type=submit], input[type=image], [role=button]');
      if (button) capture(button);
    },
    true,
  );
  addEventListener('submit', (e) => capture(e.target), true);
  addEventListener(
    'focusin',
    (e) => {
      if (lastKeyWasTab && isInput(e.target)) showList(e.target);
    },
    true,
  );
  addEventListener(
    'focusout',
    (e) => {
      if (listOpen && current === e.target) ipcRenderer.send('imp:pw-blur');
    },
    true,
  );
  addEventListener(
    'input',
    (e) => {
      if (listOpen && current === e.target && e.isTrusted) ipcRenderer.send('imp:pw-input', e.target.value);
    },
    true,
  );
  addEventListener(
    'scroll',
    () => {
      if (listOpen) ipcRenderer.send('imp:pw-key', 'Escape');
    },
    { capture: true, passive: true },
  );

  // A login page that puts the cursor in its field by itself gets the list too,
  // and the password screen of a two-step sign-in gets its password.
  let autoShown = false;
  const onLoaded = () => {
    askRefill();
    const el = document.activeElement;
    if (!autoShown && isInput(el) && document.hasFocus() && loginField(el)) {
      autoShown = true;
      showList(el);
    }
  };
  addEventListener('DOMContentLoaded', () => {
    onLoaded();
    setTimeout(onLoaded, 1500);
  });
}

// Chrome's window.chrome has app, csi and loadTimes; Electron's is an empty
// object. Sign-in pages (Google's above all) take a "Chrome" without them for
// an app with an embedded browser and refuse to sign in. Complete it, in the
// page's own world, before any of its scripts run. See src/main/compat.js.
if (/^https?:$/.test(location.protocol)) {
  contextBridge.executeInMainWorld({
    func: () => {
      const c = window.chrome;
      if (!c || typeof c !== 'object' || 'app' in c) return;
      // Functions that look like Chrome's own: no prototype, "[native code]" source.
      const natives = new WeakMap();
      const native = (name, impl) => {
        const fn = { [name](...args) { return impl(...args); } }[name];
        natives.set(fn, `function ${name}() { [native code] }`);
        return fn;
      };
      const toString = Function.prototype.toString;
      const patched = new Proxy(toString, {
        apply: (target, self, args) => (natives.has(self) ? natives.get(self) : Reflect.apply(target, self, args)),
      });
      natives.set(patched, 'function toString() { [native code] }');
      Object.defineProperty(Function.prototype, 'toString', { value: patched, writable: true, configurable: true, enumerable: false });

      const timing = () => performance.timing;
      const proto = () => performance.getEntriesByType('navigation')[0]?.nextHopProtocol || 'http/1.1';
      const loadTimes = native('loadTimes', () => {
        const t = timing();
        const p = proto();
        const spdy = /^(h2|h3|hq)/.test(p);
        const paint = performance.getEntriesByName('first-paint')[0];
        return {
          requestTime: t.navigationStart / 1000,
          startLoadTime: t.navigationStart / 1000,
          commitLoadTime: t.responseStart / 1000,
          finishDocumentLoadTime: t.domContentLoadedEventEnd / 1000,
          finishLoadTime: t.loadEventEnd / 1000,
          firstPaintTime: paint ? (t.navigationStart + paint.startTime) / 1000 : 0,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: spdy,
          wasNpnNegotiated: spdy,
          npnNegotiatedProtocol: spdy ? p : 'unknown',
          wasAlternateProtocolAvailable: false,
          connectionInfo: p,
        };
      });
      const csi = native('csi', () => {
        const t = timing();
        return { startE: t.navigationStart, onloadT: t.domContentLoadedEventEnd, pageT: performance.now(), tran: 15 };
      });
      const app = {
        isInstalled: false,
        getDetails: native('getDetails', () => null),
        getIsInstalled: native('getIsInstalled', () => false),
        installState: native('installState', (callback) => {
          if (typeof callback !== 'function') throw new TypeError('Error in invocation of app.installState(function callback): No matching signature.');
          setTimeout(() => callback('not_installed'));
        }),
        runningState: native('runningState', () => 'cannot_run'),
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      };
      for (const [key, value] of Object.entries({ loadTimes, csi, app })) {
        Object.defineProperty(c, key, { value, writable: true, enumerable: true, configurable: true });
      }
    },
  });
}
