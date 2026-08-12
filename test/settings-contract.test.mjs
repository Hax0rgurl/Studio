import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source span ${start} -> ${end}`);
  return source.slice(a, b);
}

test('the top bar exposes one accessible Settings gear', () => {
  assert.match(source, /id="btnSettings"[^>]*title="Settings"[^>]*aria-label="Settings"/);
  assert.match(source, /el\('btnSettings'\)\.addEventListener\('click',\(\)=>openAppSettings\('general'\)\)/);
  assert.match(source, /#modal\.settings-open \.modal-box/);
});

test('Settings centralizes the app controls people actually need', () => {
  const panel = bodyBetween('function settingsPanelHtml', 'function settingsWire');
  for (const id of [
    'settingsIdeaMinutes',
    'settingsAiBase',
    'settingsAiModel',
    'settingsTemp',
    'settingsCtx',
    'settingsImageProvider',
    'settingsVideoProvider',
    'settingsGreenroom',
    'settingsPitchDeck',
    'settingsCheck',
    'settingsStartServices'
  ]) assert.match(panel, new RegExp(id));
  for (const tab of ['General', 'AI &amp; agents', 'Media APIs', 'Services &amp; extensions']) {
    assert.match(panel, new RegExp(tab));
  }
});

test('text models are discovered from the configured server and remain user-selectable', () => {
  const connect = bodyBetween('async function aiProbe', 'function aiController');
  const panel = bodyBetween('function settingsPanelHtml', 'function settingsWire');
  assert.match(connect, /\/api\/tags/);
  assert.match(connect, /\/v1\/models/);
  assert.match(connect, /AI\.models\s*=\s*hit\.models/);
  assert.match(connect, /AI\.model\s*=\s*aiPickModel\(hit\.models\)/);
  assert.match(panel, /id="settingsAiModel"[^>]*placeholder="Choose or type a model ID"/);
  assert.match(panel, /Model names are discovered, never hard-coded/);
  assert.doesNotMatch(source, /ollama pull\s+qwen/i);
});

test('Settings and Make a Film share the exact same provider state', () => {
  const save = bodyBetween('function saveAppSettings', 'function openAppSettings');
  assert.match(save, /imageSetSelection\(imageId/);
  assert.match(save, /videoSetSelection\(videoId/);
  assert.match(save, /mediaProviderSelectionLocked\(\)/);
  assert.match(save, /localStorage\.setItem\('studio\.crew\.gr'/);
  assert.match(save, /localStorage\.setItem\('studio\.crew\.pd'/);
  assert.match(save, /localStorage\.setItem\('studio\.production\.minutes'/);

  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room, /id="crewImageProvider"/);
  assert.match(room, /id="crewVideoProvider"/);
  assert.match(room, /imageSetSelection\(event\.target\.value/);
  assert.match(room, /videoSetSelection\(event\.target\.value/);
});

test('Settings configures declared API and MCP adapter fields without browser-storing secrets', () => {
  const list = bodyBetween('function settingsProviderListHtml', 'function settingsPanelHtml');
  const config = bodyBetween('async function settingsOpenProviderConfig', 'async function settingsCheckConnections');
  assert.match(list, /data-provider-config/);
  assert.match(config, /\/api\/media\/providers\//);
  assert.match(config, /encodeURIComponent\(providerId\)/);
  assert.match(config, /method:'POST'/);
  assert.match(config, /clearFields/);
  assert.match(config, /field\.secret\?'password'/);
  assert.match(config, /blank secret keeps the saved value/i);
  assert.doesNotMatch(config, /localStorage/);
  assert.match(source, /REST, SDK, local-engine, and MCP adapters all enter through this catalogue/);
});

test('the old Script Doctor gear opens the same central Settings window', () => {
  assert.match(source, /function docSettings\(\)\{ openAppSettings\('ai'\); \}/);
  assert.doesNotMatch(source, /openModal\('Local model settings'/);
});
