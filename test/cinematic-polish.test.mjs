import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/cinematic-polish.css', import.meta.url), 'utf8');

test('the cinematic polish layer is loaded after the legacy component rules', () => {
  const legacyEnd = html.indexOf('</style>');
  const polishLink = html.indexOf('<link rel="stylesheet" href="./cinematic-polish.css">');
  assert.ok(legacyEnd >= 0 && polishLink > legacyEnd);
});

test('the visual system is restrained, reusable, and filmmaking-focused', () => {
  for (const token of ['--surface-raised', '--surface-soft', '--edge-highlight', '--shadow-raised',
    '--shadow-float', '--radius-sm', '--radius-lg', '--focus']) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /#sidebar[\s\S]*backdrop-filter:/);
  assert.match(css, /#sidebar[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /#topbar[\s\S]*backdrop-filter:/);
  assert.match(css, /\.modal-box,[\s\S]*\.sd-panel/);
  assert.match(css, /\.scene-card,[\s\S]*\.bible-card,[\s\S]*\.bd-card/);
  assert.doesNotMatch(css, /cursor:\s*(url|none)/);
});

test('keyboard, reduced-motion, loading, field, and disabled states remain explicit', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.ai-dot\.busy/);
  assert.match(css, /button:active:not\(:disabled\)/);
  assert.match(css, /input::placeholder/);
  assert.match(css, /:disabled/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover/);
  for (const label of ['Projects', 'Make a Film', 'Script', 'TasteOS', 'Boards', 'Export', 'Help &amp; About']) {
    assert.match(html, new RegExp(`title="${label}"`));
  }
});

test('the shared brand accents no longer depend on bright cyan', () => {
  assert.match(css, /--amber:\s*#b96d88/);
  assert.match(css, /--grad:\s*linear-gradient\(135deg,\s*#a65370/);
  assert.doesNotMatch(css, /#2fc4f0|#4da3ff|#2f7bf6/i);
});
