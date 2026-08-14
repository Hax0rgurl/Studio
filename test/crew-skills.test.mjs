import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'src', 'crew-skills');
const source = await readFile(path.join(repo, 'src', 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const registrySource = await readFile(path.join(root, 'registry.js'), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(registrySource, context, { filename: 'registry.js' });
const registry = context.globalThis.CREW_SKILL_REGISTRY;

test('every Studio crew role has exactly one versioned skill book', async () => {
  const roster = source.slice(source.indexOf('const CREW_ROSTER'), source.indexOf('const CREW_ALL'));
  const roleIds = [...roster.matchAll(/\{ id:'([^']+)'/g)].map(match => match[1]).sort();
  const manifestIds = Object.keys(manifest.roles).sort();
  assert.equal(roleIds.length, 23);
  assert.deepEqual(manifestIds, roleIds);
  assert.equal(registry.schema, 'agentic-movie-studio/crew-skills@1');
  assert.equal(registry.version, manifest.version);

  for (const [roleId, directory] of Object.entries(manifest.roles)) {
    const content = await readFile(path.join(root, directory, 'SKILL.md'), 'utf8');
    assert.equal(registry.roles[roleId].content, content, `${roleId} registry drift`);
    assert.equal(registry.roles[roleId].version, manifest.version);
    assert.match(content, /^---\nname: agentic-studio-[a-z0-9-]+\ndescription: .+\n---/);
    for (const heading of ['## Mandate', '## Authority and boundaries', '## Required inputs',
      '## Procedure', '## Output contract', '## Validation', '## Repair, escalation, and handoff']) {
      assert.match(content, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${roleId} lacks ${heading}`);
    }
    assert.doesNotMatch(content, /\[TODO|TODO:/i);
  }
});

test('producer skill is routing-only and cannot waive deterministic production gates', async () => {
  assert.equal(manifest.roles.producer, 'agentic-studio-producer');
  const content = await readFile(path.join(root, manifest.roles.producer, 'SKILL.md'), 'utf8');
  assert.match(content, /ready-role list supplied by Studio/i);
  assert.match(content, /May not write screenplay, bibles, Look, shots, prompts, images, takes, or the cut/i);
  assert.match(content, /May not change the selected model, image provider, video provider, credentials, billing approval/i);
  assert.match(content, /No required review, taste, persistence, billing, render, or final-file gate is waived/i);
});

test('the shared constitution forbids fake file and completion claims in place of artifacts', () => {
  assert.match(registry.constitution, /Literal artifact rule/);
  assert.match(registry.constitution, /Never substitute a sentence saying that a file, document, field, prompt, design, or handoff was created/);
  assert.match(registry.constitution, /A field path such as `look\.design` is not evidence/);
  assert.match(registry.constitution, /An empty constraint list is not a completed creative handoff/);
});

test('skills are actually loaded into agent systems and inspectable in the Crew UI', () => {
  const system = source.slice(source.indexOf('function crewSystem'), source.indexOf('function crewContext'));
  assert.match(source, /<script src="\.\/crew-skills\/registry\.js"><\/script>/);
  assert.match(system, /CREW_SKILLS\.constitution/);
  assert.match(system, /book\.content/);
  assert.match(source, /data-crew-skill/);
  assert.match(source, /exact versioned operating manual loaded into/);
  assert.match(source, /will not run on a generic prompt/);
});

test('the TasteOS reviewer has its own current skill identity', async () => {
  assert.equal(manifest.roles.taste, 'agentic-studio-taste-os-reviewer');
  const content = await readFile(path.join(root, manifest.roles.taste, 'SKILL.md'), 'utf8');
  assert.equal(registry.roles.taste.name, 'agentic-studio-taste-os-reviewer');
  assert.equal(registry.roles.taste.title, 'TasteOS Reviewer');
  assert.match(content, /TasteOS foundation, weighted rubric, active learned rules/);
  assert.doesNotMatch(content, /Muse's Eye/);
});

test('screenwriter is schema-first and Fountain is compatibility only', async () => {
  const book = await readFile(path.join(root, manifest.roles.writer, 'SKILL.md'), 'utf8');
  const writer = source.slice(source.indexOf('const CREW_SCREENPLAY_SCHEMA'), source.indexOf('async function crewCoverage'));
  assert.match(book, /validated structured scene data/);
  assert.match(book, /Fountain is available only/);
  assert.match(writer, /additionalProperties:false/);
  assert.match(writer, /schema:CREW_SCREENPLAY_PLAN_SCHEMA/);
  assert.match(writer, /schema:CREW_SCREENPLAY_SCENE_SCHEMA/);
  assert.match(writer, /schema:CREW_SCREENPLAY_REVIEW_SCHEMA/);
  assert.match(writer, /crewWritePlannedScene/);
  assert.match(writer, /crewReviewScreenplay/);
  assert.match(writer, /Fountain remains an import\/export adapter/);
  assert.doesNotMatch(writer, /parseScript\s*\(/);
});

test('render and edit skills cannot confuse queueing with a finished movie', async () => {
  const stills = await readFile(path.join(root, manifest.roles.stills, 'SKILL.md'), 'utf8');
  const secondUnit = await readFile(path.join(root, manifest.roles.second_unit, 'SKILL.md'), 'utf8');
  const editor = await readFile(path.join(root, manifest.roles.editor, 'SKILL.md'), 'utf8');
  assert.match(stills, /queue acknowledgement is not a photograph/i);
  assert.match(secondUnit, /A queue ID proves acceptance, not completion/);
  assert.match(editor, /final video file exists/);
  assert.match(editor, /Expected-shot, selected-take, and assembled-clip counts match exactly/);
});
