import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing source region ${start}`);
  return source.slice(a, b);
}

test('written screenplay exports editable Fountain, formatted print/PDF, and joins the bundle', () => {
  assert.match(source, /id="expScriptFountain"/);
  assert.match(source, /id="expScriptPrint"/);
  assert.match(source, /function buildScreenplayFountain\(\)/);
  assert.match(source, /function screenplayPrintDocument\(\)/);
  assert.match(source, /12pt\/1\.02 Courier/);
  assert.match(source, /\{ name: stub\+'\/'\+stub\+'\.fountain', content: buildScreenplayFountain\(\) \}/);
});

test('Settings Project files renders the real saved project and draft database', () => {
  const body = between('function settingsProjectFilesHtml', 'function settingsPanelHtml');
  assert.match(body, /DB\.projects\.reduce/);
  assert.match(body, /project\.drafts/);
  assert.match(body, /data-settings-open-project/);
  assert.match(body, /Open full project library/);
  assert.match(body, /Save current \.ams/);
});

test('a 77-page script represented by three long scenes expands beyond three Cork cards', () => {
  const body = between('function makeCard', 'let cardDrag');
  let n = 0;
  const context = {
    uid: () => `card-${++n}`,
    S: {
      cards: [1, 2, 3].map(index => ({ id: `old-${index}`, sceneNum: String(index), title: `Scene ${index}`, synopsis: '', status: 'drafted', cast: [] })),
      scenes: [
        { num: '1', slug: 'INT. ONE - DAY', eighths: 200, text: Array(30).fill('First scene story beat.').join('\n\n'), synopsis: '', characters: [] },
        { num: '2', slug: 'INT. TWO - DAY', eighths: 200, text: Array(30).fill('Second scene story beat.').join('\n\n'), synopsis: '', characters: [] },
        { num: '3', slug: 'INT. THREE - NIGHT', eighths: 216, text: Array(30).fill('Third scene story beat.').join('\n\n'), synopsis: '', characters: [] }
      ]
    }
  };
  vm.createContext(context);
  vm.runInContext(`${body}; this.made=cardsFromScenes();`, context);
  assert.equal(context.S.cards.length, 77);
  assert.equal(context.made, 74);
  assert.equal(context.S.cards.filter(card => card.sceneNum === '3').length, 27);
});

test('Look and Storyboard expose actual agent entry points', () => {
  assert.match(source, /id="btnCrewLook"/);
  assert.match(source, /function crewFillMissingLook\(\)/);
  assert.match(source, /id="btnBoardAgentPhotos"/);
  assert.match(source, /id="btnBoardAgentMovie"/);
  assert.match(source, /async function crewStoryboardPhotoPass\(\)/);
  assert.match(source, /crewRun\('second_unit'/);
});

test('Taste rubric accepts human criteria and Evaluation Lab exposes one selected workload', () => {
  assert.match(source, /id="tasteRubricAdd"/);
  assert.match(source, /Add your own criterion/);
  assert.match(source, /data-rubric-remove/);
  assert.match(source, /id="tasteWorkloadSelect"/);
  assert.match(source, /id="tasteCandidateModel"/);
  assert.match(source, /saved department test cases—not/);
});
