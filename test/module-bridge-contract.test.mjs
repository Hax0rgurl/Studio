import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('src/index.html', root), 'utf8');
const begin = '/* STUDIO MODULE BRIDGE BEGIN';
const end = '/* STUDIO MODULE BRIDGE END */';
const bridgeSource = html.slice(html.indexOf(begin), html.indexOf(end));

function fixture() {
  let serial = 0;
  let messageHandler = null;
  const posts = [];
  const frames = {
    modCards: { contentWindow: { postMessage(message) { posts.push(message); } } },
    modSlate: { contentWindow: { postMessage(message) { posts.push(message); } } }
  };
  const statuses = [
    { k: 'idea', label: 'Idea', color: '#999' },
    { k: 'outlined', label: 'Outlined', color: '#288' },
    { k: 'drafted', label: 'Drafted', color: '#d90' },
    { k: 'revised', label: 'Revised', color: '#658' },
    { k: 'locked', label: 'Locked', color: '#687' },
    { k: 'cut', label: 'Cut', color: '#b54' }
  ];
  const state = {
    title: 'Shared Feature',
    cards: [{ id: 'card-1', title: 'Kitchen turn', synopsis: 'Mara finds the key.', status: 'drafted', sceneNum: '1', cast: ['MARA'] }],
    scenes: [{
      num: '1', slug: 'INT. KITCHEN - NIGHT', synopsis: 'Mara finds the key.', intExt: 'INT',
      location: 'KITCHEN', master: 'KITCHEN', sub: '', area: '', tod: 'NIGHT', todBucket: 'NIGHT',
      text: 'MARA opens the drawer.', eighths: 4, characters: ['MARA'], elements: {},
      shots: [{
        id: 'shot-1', num: '1A', size: 'CU', angle: 'Eye level', move: 'Push in', lens: '50mm',
        desc: 'The key catches light.',
        prompt: { text: 'Close on a brass key.', seconds: 8, target: 'seedance-2' },
        takes: [{ id: 'take-1', at: '2026-08-11T00:00:00.000Z', model: 'Seedance', rating: 'circled', notes: 'Keep', file: 'one.mp4', seed: '4' }]
      }]
    }],
    bibles: { characters: { MARA: '40s, severe bob' }, locations: { KITCHEN: 'Green tile.' }, props: { KEY: 'Old brass.' } },
    look: { aspect: '2.39:1', tone: 'controlled', palette: 'green and brass', lighting: 'hard moonlight', lensing: 'spherical', camera: 'deliberate', framing: 'centered', design: 'worn' },
    moduleState: {}
  };
  const window = { addEventListener(type, handler) { if (type === 'message') messageHandler = handler; } };
  const context = {
    console, window, structuredClone, Date, JSON, Object, Array, Map, Set, String, Number,
    S: state,
    ACTIVE: { p: 'project-1', d: 'draft-1' },
    CARD_STATUS: statuses,
    cardStatus(k) { return statuses.find((x) => x.k === k) || statuses[0]; },
    makeCard(over) { return { id: `new-${++serial}`, title: '', synopsis: '', status: 'idea', sceneNum: '', cast: [], ...over }; },
    sceneForCard(card) { return state.scenes.find((scene) => String(scene.num) === String(card.sceneNum)); },
    cardsFromScenes() { return 0; },
    persist() {},
    persistNow() { context.persisted = (context.persisted || 0) + 1; },
    uid() { return `uid-${++serial}`; },
    el(id) { return frames[id] || null; },
    parseSlugline(slug) { return { intExt: slug.startsWith('EXT') ? 'EXT' : 'INT', location: 'UNTITLED', master: 'UNTITLED', sub: '', area: '', tod: 'DAY' }; },
    todBucket(tod) { return tod === 'NIGHT' ? 'NIGHT' : 'DAY'; },
    cats() { return []; }
  };
  vm.createContext(context);
  vm.runInContext(`${bridgeSource}\nglobalThis.bridge = StudioModuleBridge;`, context, { filename: 'studio-module-bridge.js' });
  return { context, state, bridge: context.bridge, frames, posts, dispatch: event => messageHandler(event) };
}

test('Cork Board snapshot contains only the active Studio cards and writes linked edits back', () => {
  const { state, bridge } = fixture();
  const cork = bridge.corkProject();
  assert.equal(cork.title, 'Shared Feature');
  assert.deepEqual(Object.keys(cork.cards), ['card-1']);
  assert.equal(cork.cards['card-1'].studioSceneNum, '1');
  assert.ok(!JSON.stringify(cork).includes('AVA'));

  cork.title = 'Renamed Feature';
  cork.cards['card-1'].title = 'Kitchen reversal';
  cork.cards['card-1'].synopsis = 'Mara destroys the key.';
  cork.cards['card-1'].status = 'revised';
  bridge.applyCorkProject(cork);

  assert.equal(state.title, 'Renamed Feature');
  assert.equal(state.cards[0].status, 'revised');
  assert.equal(state.scenes[0].slug, 'INT. KITCHEN - NIGHT');
  assert.equal(state.scenes[0].synopsis, 'Mara destroys the key.');
  assert.equal(state.moduleState.cork.cards['card-1'].id, 'card-1');
});

test('Slate snapshot and update share canonical scenes, shot specs, prompts, and takes', () => {
  const { state, bridge } = fixture();
  const slate = bridge.slateProject();
  const shot = slate.scenes[0].shots[0];
  assert.equal(slate.scenes[0].studioSceneNum, '1');
  assert.equal(shot.id, 'shot-1');
  assert.equal(shot.prompt, 'Close on a brass key.');
  assert.equal(shot.takes[0].rating, 'circled');

  slate.name = 'Shared Feature v2';
  slate.scenes[0].synopsis = 'Changed in Slate.';
  shot.intent = 'A colder insert.';
  shot.spec.size = 'ECU';
  shot.spec.movement = 'Static';
  shot.prompt = 'Extreme close-up of the cold brass key.';
  shot.takes.unshift({ id: 'take-2', loggedAt: '2026-08-11T01:00:00.000Z', model: 'Local', prompt: shot.prompt, rating: 'no-good', notes: 'Wrong texture' });
  bridge.applySlateProject(slate);

  const canonical = state.scenes[0].shots[0];
  assert.equal(state.title, 'Shared Feature v2');
  assert.equal(state.scenes[0].synopsis, 'Changed in Slate.');
  assert.equal(canonical.size, 'ECU');
  assert.equal(canonical.move, 'Static');
  assert.equal(canonical.prompt.text, 'Extreme close-up of the cold brass key.');
  assert.equal(canonical.takes[0].rating, 'ng');
  assert.equal(state.moduleState.slate.scenes[0].shots[0].id, 'shot-1');
});

test('hosted modules use the source-validated bridge and no longer boot private demo projects', () => {
  const cork = fs.readFileSync(new URL('src/modules/cork-board/app.js', root), 'utf8');
  const slate = fs.readFileSync(new URL('src/modules/slate/slate-shim.js', root), 'utf8');
  assert.match(cork, /event\.source !== window\.parent/);
  assert.match(cork, /studioBridgePost\("request"\)/);
  assert.match(cork, /Never leak the bundled AVA demo into Studio/);
  assert.match(cork, /els\.projectMenuBtn\.hidden = true/);
  assert.match(cork, /els\.newProjectBtn\.hidden = true/);
  assert.match(cork, /els\.projectSelect\.disabled = true/);
  assert.match(slate, /event\.source !== window\.parent/);
  assert.match(slate, /if \(EMBEDDED\) return studioReady\(\)/);
  assert.match(html, /event\.source!==frame\.contentWindow/);
  assert.match(html, /message\.project\.id!==expectedId/);
});

test('a delayed hosted-module save cannot cross into the newly active draft', () => {
  const { context, state, bridge, frames, posts, dispatch } = fixture();
  const stale = bridge.corkProject();
  stale.title = 'Wrong draft title';
  context.ACTIVE.d = 'draft-2';
  state.moduleState = {};

  dispatch({
    source: frames.modCards.contentWindow,
    data: { channel: 'studio-project-bridge', version: 1, module: 'cork-board', type: 'update', project: stale }
  });

  assert.equal(state.title, 'Shared Feature');
  assert.equal(posts.at(-1).project.id, 'studio-cork-draft-2', 'parent must resend the newly active canonical snapshot');
});
