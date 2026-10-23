// Quick sanity checks (also run in CI): JS syntax and translation keys.
// Usage: npm run check
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const I18N = require(path.join(root, 'src/shared/i18n.js'));
let failed = false;

const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(name)) files.push(p);
  }
})(path.join(root, 'src'));

// 1. syntax
for (const f of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed = true;
    console.error(`Syntax error in ${path.relative(root, f)}\n${err.stderr}`);
  }
}

// 2. translation keys
const PREFIX = 'set|wel|perm|shields|menu|err|dl|bm|site|palette|ntp|hist|bmk|dlp|perf|reader|sc|toast|dlg|tip|omnibox|find|tab|unit|common|permName|auth';
const patterns = [
  /\bt\(\s*['"]([\w.-]+)['"]/g,
  /data-(?:i18n|i18n-ph|i18n-title|tip)=["']([\w.-]+)["']/g,
  /key:\s*'([\w.-]+)'/g,
  new RegExp(`'((?:${PREFIX})\\.[\\w.-]+)'`, 'g'),
];
// strings that look like keys but are API method names
const NOT_KEYS = /^(perf\.(metrics|sleepTab|sleepAll|closeTab|activateTab)|reader\.get|shields\.(stats|resetStats|adblock|allowlist|gpc|https|thirdPartyCookies)|set\.search)$/;
const used = new Set();
for (const f of files) {
  if (f.endsWith('i18n.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const re of patterns) for (const m of src.matchAll(re)) if (!NOT_KEYS.test(m[1])) used.add(m[1]);
}
for (const lang of I18N.languages) {
  const missing = [...used].filter((k) => !(k in I18N.STRINGS[lang]));
  if (missing.length) {
    failed = true;
    console.error(`Missing ${lang} translations: ${missing.join(', ')}`);
  }
}
const en = Object.keys(I18N.STRINGS.en);
for (const lang of I18N.languages) {
  const extra = en.filter((k) => !(k in I18N.STRINGS[lang]));
  if (extra.length) {
    failed = true;
    console.error(`${lang} lacks keys present in en: ${extra.join(', ')}`);
  }
}

if (failed) process.exit(1);
console.log(`OK — ${files.length} files, ${used.size} translation keys, ${I18N.languages.length} languages`);
