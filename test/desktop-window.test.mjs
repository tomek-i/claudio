// Where the desktop app's DJ window opens: where it was last closed, when that place is still on a screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWindow, placement, saveWindow } from '../apps/desktop/window-state.mjs';

const laptop = { workArea: { x: 0, y: 0, width: 1536, height: 816 } };
const second = { workArea: { x: 1536, y: -200, width: 2560, height: 1400 } }; // to the right, set higher

test('the first start is maximised, at the default size', () => {
  assert.deepEqual(placement(null, [laptop]), { bounds: null, maximized: true });
});

test('a saved place on a screen is used as it is, maximised or not', () => {
  const bounds = { x: 1700, y: 40, width: 1400, height: 900 };
  assert.deepEqual(placement({ bounds, maximized: false }, [laptop, second]), { bounds, maximized: false });
  assert.deepEqual(placement({ bounds, maximized: true }, [laptop, second]), { bounds, maximized: true });
  // a window hanging off the side still counts while its top edge can be grabbed
  assert.ok(placement({ bounds: { x: -900, y: 100, width: 1100, height: 700 }, maximized: false }, [laptop]).bounds);
});

test('a place on a screen that is gone falls back to the default, and keeps maximised as it was', () => {
  const onSecond = { bounds: { x: 1700, y: 40, width: 1400, height: 900 }, maximized: false };
  assert.deepEqual(placement(onSecond, [laptop]), { bounds: null, maximized: false });
  assert.deepEqual(placement({ ...onSecond, maximized: true }, [laptop]), { bounds: null, maximized: true });
  // only a sliver left on the screen, or the title bar above or below it
  assert.equal(placement({ bounds: { x: 1500, y: 40, width: 1400, height: 900 }, maximized: false }, [laptop]).bounds, null);
  assert.equal(placement({ bounds: { x: 100, y: -300, width: 1400, height: 900 }, maximized: false }, [laptop]).bounds, null);
  assert.equal(placement({ bounds: { x: 100, y: 800, width: 1400, height: 900 }, maximized: false }, [laptop]).bounds, null);
});

test('a damaged file is ignored', () => {
  for (const saved of [{}, { bounds: null }, { bounds: { x: 0, y: 0, width: 'wide', height: 600 } }, { bounds: { x: 0, y: 0, width: 50, height: 20 } }, { bounds: { x: 0, y: 0, width: 1000 } }]) {
    assert.equal(placement(saved, [laptop]).bounds, null, JSON.stringify(saved));
    assert.equal(placement(saved, [laptop]).maximized, true);
  }
});

test('saveWindow / loadWindow: round trip, a missing folder is made, a missing or broken file is null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-window-')), file = path.join(dir, '.dj', 'desktop-window.json');
  try {
    assert.equal(loadWindow(file), null);
    const state = { bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: false };
    saveWindow(file, state);
    assert.deepEqual(loadWindow(file), state);
    fs.writeFileSync(file, '{ not json');
    assert.equal(loadWindow(file), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
