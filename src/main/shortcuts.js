'use strict';
// Browser-wide keyboard shortcuts. Matched in `before-input-event` so they
// work no matter which web contents (UI, page, popup) has focus.
const isMac = process.platform === 'darwin';

// [modifiers, key, command, arg]   mod = Ctrl on Windows/Linux, Cmd on macOS
const BINDINGS = [
  ['mod', 't', 'new-tab'],
  ['mod', 'n', 'new-window'],
  ['mod+shift', 'n', 'new-private-window'],
  ['mod', 'w', 'close-tab'],
  ['mod', 'F4', 'close-tab'],
  ['mod+shift', 'w', 'close-window'],
  ['mod+shift', 't', 'reopen-closed-tab'],
  ['ctrl', 'Tab', 'next-tab'],
  ['ctrl+shift', 'Tab', 'prev-tab'],
  ['mod', 'PageDown', 'next-tab'],
  ['mod', 'PageUp', 'prev-tab'],
  ['mod+alt', 'ArrowRight', 'next-tab'],
  ['mod+alt', 'ArrowLeft', 'prev-tab'],
  ['mod', 'l', 'focus-omnibox'],
  ['alt', 'd', 'focus-omnibox'],
  ['', 'F6', 'focus-omnibox'],
  ['mod', 'k', 'focus-omnibox'],
  ['mod', 'r', 'reload'],
  ['', 'F5', 'reload'],
  ['mod+shift', 'r', 'hard-reload'],
  ['mod', 'F5', 'hard-reload'],
  ['shift', 'F5', 'hard-reload'],
  ['alt', 'ArrowLeft', 'back'],
  ['alt', 'ArrowRight', 'forward'],
  ['mod', '[', 'back'],
  ['mod', ']', 'forward'],
  ['alt', 'Home', 'home'],
  ['mod', 'f', 'find'],
  ['', 'F3', 'find-next'],
  ['shift', 'F3', 'find-prev'],
  ['mod', 'g', 'find-next'],
  ['mod+shift', 'g', 'find-prev'],
  ['mod', '=', 'zoom-in'],
  ['mod', '+', 'zoom-in'],
  ['mod+shift', '+', 'zoom-in'],
  ['mod+shift', '=', 'zoom-in'],
  ['mod', '-', 'zoom-out'],
  ['mod', '0', 'zoom-reset'],
  ['mod', 'd', 'bookmark-page'],
  ['mod+shift', 'b', 'toggle-bookmarks-bar'],
  ['mod+shift', 'o', 'open-bookmarks'],
  ['mod', 'h', 'open-history'],
  ['mod', 'y', 'open-history'],
  ['mod', 'j', 'open-downloads'],
  ['mod', ',', 'open-settings'],
  ['shift', 'Escape', 'open-performance'],
  ['', 'F11', 'fullscreen'],
  ['mod+ctrl', 'f', 'fullscreen'],
  ['', 'F12', 'devtools'],
  ['mod+shift', 'i', 'devtools'],
  ['mod+alt', 'i', 'devtools'],
  ['mod', 'p', 'print'],
  ['mod', 's', 'save-page'],
  ['mod', 'u', 'view-source'],
  ['mod+shift', 'a', 'command-palette'],
  ['', 'F2', 'command-palette'],
  ['mod+alt', 'r', 'reader'],
  ['', 'F9', 'reader'],
  ['mod+shift', 's', 'screenshot'],
  ['mod+shift', 'e', 'toggle-split'],
  ['mod+shift', 'm', 'mute-tab'],
  ['mod+shift', 'v', 'toggle-vertical-tabs'],
  ['alt+shift', 'i', 'shields-panel'],
  ['mod', 'q', 'quit'],
];
for (let i = 1; i <= 9; i++) BINDINGS.push(['mod', String(i), 'select-tab', i]);

const table = new Map();
for (const [mods, key, name, arg] of BINDINGS) {
  // "mod+ctrl" (Cmd+Ctrl) only exists on macOS; elsewhere it would collapse into
  // plain Ctrl and take over another shortcut (Ctrl+F used to go full screen).
  if (!isMac && mods.split('+').includes('mod') && mods.split('+').includes('ctrl')) continue;
  const set = new Set(mods.split('+').filter(Boolean).map((m) => (m === 'mod' ? (isMac ? 'meta' : 'ctrl') : m)));
  const id = ['ctrl', 'meta', 'alt', 'shift'].map((m) => (set.has(m) ? m : '')).join('|') + `|${key.toLowerCase()}`;
  table.set(id, { name, arg });
}

// Shortcuts the browser always keeps, whatever the page does (as in Chrome).
// Every other one goes to the page first (see BrowserWin.handleInput).
const RESERVED = new Set(['new-tab', 'new-window', 'new-private-window', 'close-tab', 'close-window', 'reopen-closed-tab', 'next-tab', 'prev-tab', 'fullscreen', 'devtools']);

function isReserved(name) {
  return RESERVED.has(name);
}

function match(input) {
  if (input.type !== 'keyDown' || (input.isAutoRepeat && !/^(Tab|PageUp|PageDown|F3)$/.test(input.key))) return null;
  // AltGr (reported as Ctrl+Alt) types characters such as "Í", "[" or "@" — never steal those.
  if (input.control && input.alt && input.key.length === 1 && !/^[a-z0-9]$/i.test(input.key)) return null;
  // Ctrl+Shift+digit produces symbols on some layouts, so fall back to the physical key.
  const keys = [input.key];
  if (/^Digit\d$/.test(input.code)) keys.push(input.code.slice(5));
  if (/^Key[A-Z]$/.test(input.code)) keys.push(input.code.slice(3).toLowerCase());
  if (input.code === 'Equal') keys.push('=');
  if (input.code === 'Minus' || input.code === 'NumpadSubtract') keys.push('-');
  if (input.code === 'NumpadAdd') keys.push('+');
  if (input.code === 'Numpad0') keys.push('0');
  const prefix = [input.control ? 'ctrl' : '', input.meta ? 'meta' : '', input.alt ? 'alt' : '', input.shift ? 'shift' : ''].join('|');
  for (const k of keys) {
    const hit = table.get(`${prefix}|${String(k).toLowerCase()}`);
    if (hit) return hit;
  }
  return null;
}

// Human readable list for the settings page.
function describe() {
  const pretty = (mods, key) =>
    [...mods.split('+').filter(Boolean).map((m) => (m === 'mod' ? (isMac ? '⌘' : 'Ctrl') : m[0].toUpperCase() + m.slice(1))), key.length === 1 ? key.toUpperCase() : key].join('+');
  const seen = new Map();
  for (const [mods, key, name] of BINDINGS) {
    if (name === 'select-tab') continue;
    if (!seen.has(name)) seen.set(name, []);
    if (seen.get(name).length < 2) seen.get(name).push(pretty(mods, key));
  }
  return [...seen.entries()].map(([name, keys]) => ({ name, keys }));
}

module.exports = { match, describe, isReserved };
