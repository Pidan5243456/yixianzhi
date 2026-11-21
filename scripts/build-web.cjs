const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
// This directory is generated exclusively by this script.
if (path.dirname(out) !== root || path.basename(out) !== 'www') throw new Error('Invalid output');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const file of require('./web-files.cjs')) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const dir of ['css','js','assets']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true, filter: p => !p.endsWith('.md') });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=login.html"><title>衣先知</title></head><body><a href="login.html">打开衣先知</a></body></html>');
fs.writeFileSync(path.join(out, 'js/build-config.js'), `window.APP_BUILD=${JSON.stringify({ debug: !process.argv.includes('--release'), version:require('../package.json').version })};\n`);
console.log('衣先知产品资源已生成：' + out);
