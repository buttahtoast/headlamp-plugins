/**
 * esbuild can emit raw control bytes inside template strings (xterm does this
 * for a unit separator). kubectl --dry-run -o yaml refuses those bytes, so the
 * e2e cannot publish the plugin. The escape is the same character in JS.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] || 'dist/main.js';
const text = readFileSync(path, 'utf8');
let replaced = 0;
const safe = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, char => {
  replaced += 1;
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
});
writeFileSync(path, safe);
console.log(`yaml-safe-bundle: escaped ${replaced} control characters in ${path}`);
