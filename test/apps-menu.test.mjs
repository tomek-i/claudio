// The Apps menu (apps-menu.js): each app has its own copy, since the apps import nothing from each other. The copies
// stay the same, and they list the apps as the desktop suite does (apps/desktop/apps.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APPS as SUITE } from '../apps/desktop/apps.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const COPIES = ['apps/web/public/ui/apps-menu.js', 'apps/drums/public/apps-menu.js', 'apps/synth/public/apps-menu.js', 'apps/daw/public/apps-menu.js'];

test('apps-menu.js: the four copies are the same file (change apps/web/public/ui/apps-menu.js and copy it to the others)', () => {
  const [first, ...rest] = COPIES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));
  rest.forEach((text, i) => assert.equal(text, first, `${COPIES[i + 1]} differs from ${COPIES[0]}`));
});

test('apps-menu.js: the same apps, names and ports as the desktop suite', () => {
  const src = fs.readFileSync(path.join(ROOT, COPIES[0]), 'utf8');
  const listed = [...src.matchAll(/\{ id: '(\w+)', name: '([^']+)', what: '[^']*', port: (\d+)/g)].map(([, id, name, port]) => ({ id, name, port: Number(port) }));
  assert.deepEqual(listed, SUITE.map(({ id, name, port }) => ({ id, name, port })));
});

test('every page has an Apps button and mounts the menu as itself', () => {
  for (const [page, script, id] of [['apps/web/public/index.html', 'apps/web/public/app.js', 'dj'], ['apps/drums/public/index.html', 'apps/drums/public/app.js', 'drums'], ['apps/synth/public/index.html', 'apps/synth/public/app.js', 'synth'], ['apps/daw/public/index.html', 'apps/daw/public/app.js', 'daw']]) {
    assert.match(fs.readFileSync(path.join(ROOT, page), 'utf8'), /id="appsBtn"/, page);
    assert.match(fs.readFileSync(path.join(ROOT, script), 'utf8'), new RegExp(`mountAppsMenu\(.*appsBtn.*'${id}'\)`), script);
  }
});
