import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const nativeMain = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const nativeTaste = await readFile(new URL('../src-tauri/src/taste_os.rs', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source span ${start} -> ${end}`);
  return source.slice(a, b);
}

test('TasteOS is a visible revisioned backend, not a decorative take panel', () => {
  assert.match(source, /data-view="tasteos"/);
  assert.match(source, /id="view-tasteos"/);
  assert.match(source, /Your editable taste profile, judgment rubric, evidence, confidence, and learned crew constraints/);
  for (const command of ['taste_os_snapshot', 'taste_os_record_feedback', 'taste_os_set_foundation',
    'taste_os_set_rubric', 'taste_os_apply_learning', 'taste_os_review_rule', 'taste_os_record_workload',
    'taste_os_record_experiment', 'taste_os_review_experiment', 'taste_os_review_proposal',
    'taste_os_workload_detail', 'taste_os_experiment_detail']) {
    assert.match(source, new RegExp(command));
    assert.match(nativeMain, new RegExp(command));
  }
  assert.match(nativeTaste, /MAX_CONFIDENCE_DELTA: f64 = 0\.12/);
  assert.match(nativeTaste, /rule\.evidence_ids\.len\(\) >= 3/);
  assert.match(nativeTaste, /rule\.project_ids\.len\(\) >= 2/);
  assert.match(nativeTaste, /scope: if explicit_global[\s\S]*"global"\.into\(\)[\s\S]*"project"\.into\(\)/);
  assert.match(nativeTaste, /evidence quote is not an exact excerpt/);
  assert.match(nativeTaste, /proposal attempts to change operational settings rather than taste/);
  assert.match(nativeTaste, /WORKLOAD_SCHEMA: &str = "studio\/taste-os-workload@1"/);
  assert.match(nativeTaste, /EXPERIMENT_SCHEMA: &str = "studio\/taste-os-experiment@1"/);
  assert.match(nativeTaste, /only a human-selected candidate winner can be recommended for future work/);
  assert.match(nativeTaste, /TasteOS proposals cannot change operational settings/);
});

test('Evaluation Lab is model-agnostic, human-reviewed, and cannot silently deploy a winner', () => {
  const lab = bodyBetween('function tasteObjectiveHtml', 'function renderTasteOs');
  const operations = bodyBetween('async function tasteReviewProposalNow', 'function tasteAgentBrief');
  assert.match(lab, /Candidate model ID — choose any installed model or type one/);
  assert.match(lab, /Baseline wins/);
  assert.match(lab, /Candidate wins/);
  assert.match(lab, /Neither passes/);
  assert.match(operations, /telemetry:false/);
  assert.match(operations, /const prior=\{model:AI\.model,temperature:AI\.temperature,numCtx:AI\.numCtx,noThink:AI\.noThink\}/);
  assert.match(operations, /Object\.assign\(AI,prior\)/);
  assert.doesNotMatch(operations, /aiSave\(\)/);
  assert.match(source, /This is offline evidence only: it does not change the current model, provider, API, or a film already in progress/);
  assert.match(source, /Recommend the candidate for future work/);
});

test('model work is fail-closed around the native private receipt ledger', () => {
  const stream = bodyBetween('/** Stream one completion.', '/* ---------- scrubbing what the model gives back ---------- */');
  assert.match(stream, /const workload=await tasteWorkloadStart\(system,user,opts\|\|\{\}\)/);
  assert.match(stream, /TasteOS could not save the model-work receipt, so Studio did not accept the result/);
  assert.match(stream, /await settle\('completed',out,''\)/);
  assert.match(nativeTaste, /workloads\.jsonl/);
  assert.match(nativeTaste, /config: WorkloadConfig \{ response_schema: String::new\(\)/);
  assert.doesNotMatch(nativeTaste, /pub (api_key|authorization|headers|endpoint):/);
});

test('every formal prompt and review agent receives its full skill book and current TasteOS constraints', () => {
  const run = bodyBetween('/** Run one department. */', '/** The whole crew, in order, on one idea. */');
  const prompts = bodyBetween('async function crewWritePrompts', 'async function crewSupervise');
  const supervisor = bodyBetween('async function crewSupervise', 'async function crewTaste');
  const taste = bodyBetween('async function crewTaste', 'async function crewStillPrompts');
  const promptEngine = bodyBetween('async function plRun', 'function plRenderProgress');
  assert.match(run, /await tasteLoadSnapshot\(\)/);
  assert.match(prompts, /plRun\(targets,role\)/);
  assert.match(promptEngine, /crewSystem\(crewRole\)/);
  assert.match(promptEngine, /crewContext\(crewRole/);
  assert.match(supervisor, /critique\([\s\S]*,role\)/);
  assert.match(supervisor, /status:bad\?'failed':'done'/);
  assert.match(taste, /critiqueTaste\([\s\S]*,role\)/);
  assert.match(taste, /status:kill\?'failed':'done'/);
  assert.match(source, /FILMMAKER FOUNDATION — explicit and locked/);
  assert.match(source, /HOW YOUR HANDOFF WILL BE JUDGED/);
});

test('Look departments reject agentic file claims and fake evidence instead of marking them done', () => {
  const functions = bodyBetween('function crewLookSchema', '/** A Look department makes one coherent, validated department handoff. */');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functions}\nglobalThis.__parse=crewParseLook; globalThis.__schema=crewLookSchema;`, context);
  assert.deepEqual(Array.from(context.__schema(['tone','refs']).properties.decisions.items.properties.field.enum),['tone','refs']);
  const labelled=context.__parse({
    decisions:[
      {field:'Tone / themes',value:'Memory is presented through precise changes in domestic ritual, repeated family gestures, and discrepancies between what the rooms preserve and what the returning daughter remembers.',evidence:['The filmmaker asks for nostalgia, memory, and dreams instead of grime or decay.'],constraints:['Keep every emotional turn attached to observable family behavior and recurring domestic objects.']},
      {field:'Reference films / looks',value:'Use the intimate temporal dislocation of Aftersun and the domestic memory architecture of The Eternal Daughter as behavioral references, without copying either film\'s plot or palette.',evidence:['The film concerns a returned daughter, an absent brother, photographs, and a preserved room.'],constraints:['References guide duration, withholding, and domestic observation only; this film keeps its own story and locations.']}
    ],clientUpdate:'The film now has a grounded memory logic and two usable formal references.',handoffChecks:['story editor']
  },['tone','refs']);
  assert.deepEqual(Array.from(labelled.decisions,row=>row.field),['tone','refs']);
  const fake = {
    decisions: [{
      field: 'design',
      value: 'living_room_design.md created with material palette, architecture, condition, scale, dressing logic, collision surfaces, and continuity constraints for the matte red rubber ball test.',
      evidence: ['look.design'],
      constraints: []
    }],
    clientUpdate: 'Created look.design with the actual details hidden in this summary instead of the owned artifact field.',
    handoffChecks: ['location_scout']
  };
  assert.throws(() => context.__parse(fake, ['design']), /file or tool action|evidence|constraints/);
  const crossedBoundary = structuredClone(fake);
  crossedBoundary.decisions[0] = {
    field: 'design',
    value: 'The room uses worn oak boards and matte plaster, with the chair fixed exactly two metres from the camera plane and its straight wooden back facing camera throughout the collision.',
    evidence: ['The filmmaker requires one ordinary furnished living room and a wooden chair leg.'],
    constraints: ['Keep the chair on the same oak floorboard seam in every shot.']
  };
  assert.throws(() => context.__parse(crossedBoundary, ['design']), /crossed into another department/);
  const real = {
    decisions: [{
      field: 'design',
      value: 'The modest living room uses worn tongue-and-groove oak floorboards, matte off-white plaster walls, a low cotton sofa, and one solid oak dining chair whose square front leg presents a hard, repeatable collision face.',
      evidence: ['The filmmaker requires one ordinary furnished living room and a matte red rubber ball striking a wooden chair leg.'],
      constraints: ['Keep the chair leg square, solid oak, and fixed at the same floorboard seam in every shot.']
    }],
    clientUpdate: 'The room now has a buildable material system and a repeatable collision surface.',
    handoffChecks: ['location_scout']
  };
  assert.equal(context.__parse(real, ['design']).decisions[0].field, 'design');
});

test('photo and video agents are required to return full showcase artifacts', () => {
  const stills = bodyBetween('async function crewStillPrompts', 'const CREW_BIBLE_SCHEMA');
  for (const label of ['SHOT', 'SUBJECT', 'PHYSICAL STATE', 'ENVIRONMENT', 'LIGHTING', 'CAMERA', 'FILM STOCK',
    'COLOR GRADE', 'COMPOSITION', 'IMPERFECTION', 'AESTHETIC REFUSALS', 'AVOID']) {
    assert.match(stills, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const promptSpines = bodyBetween('const PL_SHARED_CRAFT', 'let PL =');
  for (const label of ['REFERENCE', 'STYLE & MOOD', 'SHOT DIRECTION', 'ACTOR BEHAVIOR',
    'ENVIRONMENTAL FORCE', 'CAMERA BEHAVIOR', 'AUDIO']) {
    assert.match(promptSpines, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(promptSpines, /one meaningful beat per two to three seconds|Whole-second ranges/);
  assert.match(promptSpines, /Bodies have mass/);
  assert.match(promptSpines, /one continuous space/);
  assert.doesNotMatch(promptSpines, /camera moves you do not want/);
});

test('a still identifier or thin checklist cannot pass as a showcase photo prompt', () => {
  const functions = bodyBetween('const CREW_STILL_PROMPT_MIN', 'async function crewStillPrompts');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functions}\nglobalThis.__parseStill=crewParseStillPrompt;`, context);
  const thin = {
    shot:'s1_wide_static',subject:'matte red rubber ball',environment:'ordinary room',lighting:'soft daylight',camera:'wide 35mm',
    filmStock:'digital',colorGrade:'neutral',composition:'ball beside chair',imperfection:'dust',aestheticRefusals:['no gloss'],avoid:[]
  };
  assert.throws(()=>context.__parseStill(thin,'1A'), /thin or missing|identifier/);
  const real = {
    shot:'A static eye-level wide frame freezes the ball one ball-width before it touches the chair leg.',
    subject:'One matte red rubber ball remains perfectly round, uncompressed, and one ball-width left of the oak leg.',
    physicalState:'The ball keeps its full weight on the oak floor at one contact patch; gravity holds it down and no deformation has begun.',
    environment:'A modest lived-in room holds worn oak floorboards, matte off-white plaster, and the approved fixed chair.',
    lighting:'Approved soft window light reveals the ball surface and chair-leg contact face without dramatic contrast.',
    camera:'Approved eye-level wide framing with natural perspective keeps the complete collision path legible.',
    filmStock:'Fine-grained neutral color-negative response.',
    colorGrade:'Restrained neutral browns and off-whites leave the ball as the only saturated red.',
    composition:'The chair leg sits left of center; the ball is one diameter away with open negative space continuing behind it toward back right.',
    imperfection:'Floor scuffs, chair-edge wear, and fine settled dust remain visible and physically plausible.',
    aestheticRefusals:['No showroom polish or decorative cinematic haze.'],avoid:['No motion blur','No extra ball']
  };
  assert.equal(context.__parseStill(real,'1A','The ball rolls across the oak floor toward the chair leg.').shot,real.shot);
  const explicitSupport=structuredClone(real);
  explicitSupport.physicalState+=' It is not hovering or floating.';
  assert.equal(context.__parseStill(explicitSupport,'1A','The ball rolls across the oak floor.').physicalState,explicitSupport.physicalState);
  const floating=structuredClone(real);
  floating.subject='One matte red rubber ball is hovering one ball-width left of the oak chair leg without touching the floor.';
  assert.throws(()=>context.__parseStill(floating,'1A','The ball rolls across the oak floor.'),/unsupported hovering or floating/);
});

test('Client Room exposes checkpointed artifacts, live navigation, direction, and focused department rework', () => {
  const locks = bodyBetween('function crewApplyMutationLock', 'const CREW_UNPROVEN_CODE');
  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(locks, /button\.disabled=false/);
  assert.match(locks, /production-readonly/);
  assert.match(room, /Actual checkpointed department output/);
  assert.match(room, /crewArtifactText\(entry\.artifact\)/);
  assert.match(room, /data-artifact-view/);
  assert.match(room, /Your direction to the working crew/);
  assert.match(room, /data-review-approve/);
  assert.match(room, /data-review-flag/);
  assert.match(source, /crewQueueRework\(roleId,note,verdict\)/);
  assert.doesNotMatch(bodyBetween('function crewTranscriptEntries', 'function productionCheckpoint'), /role\.job/);
});

test('human take review records evidence and queues only the flagged shot for a new cut attempt', async () => {
  const shot = {
    id: 'shot-a', num: '1A', prompt: { text: 'A locked shot prompt.' },
    takes: [{ id: 'take-a', rating: 'good', model: 'local', file: '/tmp/a.mp4', notes: '' },
      { id: 'take-b', rating: 'circled', model: 'local', file: '/tmp/b.mp4', notes: '' }]
  };
  const feedback = [];
  const reworks = [];
  const context = {
    console, JSON, String, Date,
    ACTIVE: { p: 'project-a', d: 'draft-a' },
    allShots: () => [{ sc: { num: 1 }, sh: shot }],
    persistNow: () => true,
    tasteRecordFeedback: async request => { feedback.push(request); },
    crewQueueShotRework: (shotId, note, verdict) => { reworks.push({ shotId, note, verdict }); return true; },
    productionState: () => null,
    productionCheckpoint: () => true,
    toast: () => {}
  };
  vm.createContext(context);
  const review = bodyBetween('async function reviewTake', 'function renderTakes');
  vm.runInContext(`${review}\nglobalThis.__reviewTake=reviewTake;`, context);

  assert.equal(await context.__reviewTake('shot-a', 'take-a', 'revise', ''), false, 'rework needs a human reason');
  assert.equal(await context.__reviewTake('shot-a', 'take-a', 'revise', 'The movement feels decorative.'), true);
  assert.equal(shot.takes[0].humanReview.verdict, 'revise');
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].note, 'The movement feels decorative.');
  assert.deepEqual(reworks, [{ shotId: 'shot-a', note: 'The movement feels decorative.', verdict: 'revise' }]);

  const rework = bodyBetween('async function crewProcessShotReworks', 'function crewTranscriptEntries');
  assert.match(rework, /find\(row=>row\.sh\.id===item\.shotId\)/);
  assert.match(rework, /sh\.revisions\.unshift/);
  assert.match(rework, /p\.targetShotReworkId=sh\.id/);
  assert.match(rework, /p\.targetVideoReworkId=sh\.id/);
  assert.match(rework, /p\.assemblyRunId=p\.id\+'-revision-'/);
  assert.match(rework, /p\.jobHistory\.unshift/);
  assert.match(rework, /p\.cutHistory/);
});

test('Takes and storyboard photos expose the filmmaker review vocabulary', () => {
  const takes = bodyBetween('function renderTakes', 'function editTake');
  for (const verdict of ['Keep', 'Circle', 'Flag', 'Revise', 'Kill']) assert.match(takes, new RegExp(`>${verdict}<`));
  const boards = bodyBetween('async function renderBoards', 'function boardDetail');
  assert.match(boards, />Keep photo</);
  assert.match(boards, />Flag</);
  assert.match(boards, />Kill</);
  assert.match(source, /kind:'storyboard_review'/);
  assert.match(source, /kind:'take_review'/);
});
