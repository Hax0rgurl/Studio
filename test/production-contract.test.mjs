import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source span ${start} -> ${end}`);
  return source.slice(a, b);
}

function loadFunction(start, end, name, context) {
  vm.createContext(context);
  vm.runInContext(`${bodyBetween(start, end)}\nglobalThis.__fn = ${name};`, context, { filename: `${name}.js` });
  return context.__fn;
}

function providerStubs() {
  return {
    crewConnect: async () => ({ pitchdeck: { ok: true } }),
    crewEnsureServices: async () => ({ pitchdeck: { ok: true } }),
    videoProviderSelection: production => production?.videoProvider || { id: 'phosphene', model: '', billingApproved: false },
    videoProviderDescriptor: id => ({ id, name: id === 'phosphene' ? 'Phosphene' : id, configured: true, requiresBillingApproval: false }),
    videoReviewEnvelope: () => ({ schema: 'studio/video-review@1', gate: 'approved', reasons: [] }),
    videoBlockedShots: () => [],
    videoBillingApproval: selection => ({ approved: selection.billingApproved === true, providerId: selection.id })
  };
}

test('all executable inline scripts parse', () => {
  const blocks = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(block => block.trim());
  assert.ok(blocks.length >= 3);
  for (const block of blocks) new Function(block);
});

test('large project libraries round-trip through the synchronous compressed durability journal', () => {
  const codec=source.slice(source.indexOf("const PROJECT_DB_PREFIX='AMSZ1:'"),source.indexOf('const ProjectDBMirror'));
  const context={Map,Array,String,Number,Uint8Array,TextEncoder,TextDecoder,btoa,atob,Error};
  vm.createContext(context);
  vm.runInContext(`${codec}; globalThis.encode=projectDbEncode; globalThis.decode=projectDbDecode;`,context);
  const raw=JSON.stringify({projects:Array.from({length:1200},(_,index)=>({id:'project-'+index,
    title:'Night laundromat – océano '+index,script:'A repeated cinematic screenplay passage. '.repeat(80)}))});
  const encoded=context.encode(raw);
  assert.match(encoded,/^AMSZ1:/);
  assert.ok(encoded.length<raw.length*.7,'compressed journal must leave meaningful quota headroom');
  assert.equal(context.decode(encoded),raw);
  assert.equal(context.decode('{"projects":[]}'),'{"projects":[]}','legacy plain JSON remains readable');
});

test('idea screenplay stays in the active Studio project', () => {
  const writer = bodyBetween('async function crewWriteScript', 'async function crewCoverage');
  const executable = writer.replace(/\/\/.*$/gm, '');
  assert.match(writer, /crewPlanScreenplay/);
  assert.match(writer, /crewWritePlannedScene/);
  assert.match(writer, /crewStructuredScreenplay/);
  assert.match(writer, /S\.scenes\s*=\s*parsed\.scenes/);
  assert.match(writer, /runAutoBreakdown\(\)/);
  assert.match(writer, /productionCheckpoint/);
  assert.doesNotMatch(executable, /importText\s*\(/);
  assert.doesNotMatch(executable, /importParsed\s*\(/);
  assert.doesNotMatch(executable, /parseScript\s*\(/);
  assert.doesNotMatch(writer, /screenplay in Fountain/);
});

test('target length applies to newly authored idea/adaptation films and never constrains an existing script', () => {
  const writer = bodyBetween('const CREW_SCREENPLAY_PLAN_SCHEMA', 'async function crewCoverage');
  const start = bodyBetween('async function crewStart', 'function crewResumeOwnerMatches');
  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(writer, /if \(S\.scenes\.length&&!rewriting\) return/);
  assert.match(writer, /\['idea','adaptation'\]\.includes\(p\.mode\)/);
  assert.match(writer, /For an original idea/);
  assert.match(writer, /source-adaptation|adaptation scene/i);
  assert.match(writer, /targetMinutes/);
  assert.match(start, /\['idea','adaptation'\]\.includes\(mode\)/);
  assert.match(start, /S\.production\.targetMinutes=targetMinutes/);
  assert.doesNotMatch(start, /targetMinutes, status/);
  assert.match(room, /New-film target/);
  assert.match(room, /Current script/);
});

test('papers are developed as source adaptations instead of being reformatted as screenplay prose', () => {
  const story = bodyBetween('const CREW_SOURCE_PASS_SCHEMA', 'const CREW_SCREENPLAY_SCHEMA');
  const writer = bodyBetween('async function crewPlanScreenplay', 'async function crewCoverage');
  const readiness = bodyBetween('function crewReadyRoles', 'const CREW_PRODUCER_DECISION_BASE');
  const call = bodyBetween('async function crewCall', 'async function crewStart');
  const ingest = source.slice(source.indexOf('async function storyToScript'), source.indexOf('/* Boards toolbar */'));
  assert.match(story, /source-development digest/i);
  assert.match(story, /Consider multiple possible film forms/);
  assert.match(story, /screenEvent/);
  assert.match(story, /sourceBasis/);
  assert.match(writer, /Do not follow the paper\\'s section order/);
  assert.match(writer, /crewValidateAdaptationScreenplay/);
  assert.match(writer, /Do not paste source prose/);
  assert.match(readiness, /p\.mode==='adaptation'/);
  assert.match(readiness, /\['story_editor','director','writer','story_review'\]/);
  assert.match(call, /crewReadyRoles\(p\)/);
  assert.doesNotMatch(call, /runPipeline/);
  assert.match(ingest, /crewStart\('adaptation'/);
  assert.doesNotMatch(ingest, /Return this passage as screenplay pages/);
});

test('adaptation validation rejects a paper paragraph wearing screenplay headers', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${bodyBetween('function crewAdaptationOverlap', 'const CREW_SCREENPLAY_SCENE_SCHEMA')}
    globalThis.validateAdaptation = crewValidateAdaptationScreenplay;`, context);
  const sourceWords=Array.from({length:140},(_,index)=>'sourceword'+index);
  const copied={scenes:[{blocks:[{type:'action',text:sourceWords.join(' ')}]}]};
  assert.throws(()=>context.validateAdaptation(copied,sourceWords.join(' ')),/copies too much consecutive source prose/);
  const transformed={scenes:[{blocks:[{type:'action',text:Array.from({length:140},(_,index)=>'screenaction'+index).join(' ')}]}]};
  assert.equal(context.validateAdaptation(transformed,sourceWords.join(' ')),transformed);
});

test('agentic screenplay development plans, checkpoints each scene, and loops through independent review', () => {
  const context = { Array, String, Number, Error, Math };
  vm.createContext(context);
  vm.runInContext(`${bodyBetween('function crewValidateScreenplayPlan', 'function crewWriterWork')}
    globalThis.validatePlan=crewValidateScreenplayPlan;`,context);
  const plan={scenePlan:[
    {sceneNumber:1,durationSeconds:30,sourceBasis:'original premise'},
    {sceneNumber:2,durationSeconds:30,sourceBasis:'original premise'}
  ]};
  assert.equal(context.validatePlan(plan,1,false),plan);
  assert.throws(()=>context.validatePlan({scenePlan:[{sceneNumber:2,durationSeconds:60,sourceBasis:'source'}]},1,true),/contiguous/);
  assert.throws(()=>context.validatePlan({scenePlan:[{sceneNumber:1,durationSeconds:5,sourceBasis:'source'}]},1,true),/outside the usable range/);

  const development=bodyBetween('async function crewPlanScreenplay', 'const CREW_COVERAGE_SCHEMA');
  assert.match(development,/if \(work\.sceneDrafts\[key\]\) return work\.sceneDrafts\[key\]/);
  assert.match(development,/work\.sceneDrafts\[key\]=scene/);
  assert.match(development,/productionCheckpoint\(\)===false/);
  assert.match(development,/INDEPENDENT STORY-EDITOR NOTES/);
  assert.match(development,/schema:CREW_SCREENPLAY_REVIEW_SCHEMA/);
  const call=bodyBetween('async function crewCall','async function crewStart');
  assert.match(call,/p\.writerWork\.review\.verdict==='revise'/);
  assert.match(call,/productionStep\('writer','waiting'/);
  assert.match(call,/productionStep\('story_review','waiting'/);
  assert.match(call,/after two targeted revision passes/i);
});

test('a bounded producer agent selects only departments proven ready by the canonical graph', () => {
  const readiness=bodyBetween('function crewReadyRoles','const CREW_PRODUCER_DECISION_BASE');
  const producer=bodyBetween('async function crewPlanNext','/** The whole crew');
  const call=bodyBetween('async function crewCall','async function crewStart');
  assert.match(readiness,/CREW_BIBLE_PHASE/);
  assert.match(readiness,/CREW_VISUAL_PREP_PHASE/);
  assert.match(readiness,/crewStoryboardNextRole\(p\)/);
  assert.match(readiness,/CREW_MOTION_PREP_PHASE/);
  assert.match(readiness,/CREW_PROMPT_PHASE/);
  assert.match(readiness,/\['second_unit'\],\['editor'\]/);
  assert.match(producer,/schema\.properties\.nextRole\.enum=candidates/);
  assert.match(producer,/if \(!candidates\.includes\(decision\.nextRole\)\)/);
  assert.match(producer,/p\.orchestration\.decisions\.push\(record\)/);
  assert.match(producer,/productionCheckpoint\(\)===false/);
  assert.match(call,/crewRun\('producer',ask\)/);
  assert.match(call,/if \(!ready\.includes\(id\)\)/);
  assert.doesNotMatch(producer,/providerId\s*=|billingApproved\s*=|model\s*=/);
});

test('the ChatDev-style production loop is finite, progress-bound, and yields to media rendering', () => {
  const guard=bodyBetween("const CREW_LOOP_GUARD_SCHEMA",'function crewRoleFinished');
  const call=bodyBetween('async function crewCall','async function crewStart');
  assert.match(guard,/studio\/chatdev-bounded-loop@1/);
  assert.match(guard,/maxNoProgressFailures:3/);
  assert.match(guard,/crewProgressFingerprint/);
  assert.match(guard,/after!==ticket\.fingerprint/);
  assert.match(call,/const turnLimit=Math\.max\(80/);
  assert.match(call,/const loopTicket=crewLoopTicket\(p,id\)/);
  assert.match(call,/const loopResult=crewLoopRecord\(p,loopTicket,result\)/);
  assert.match(call,/returned without changing/);
  assert.match(call,/\['rendering','assembling','paused'\]\.includes\(p\.status\)\) break/);
  assert.doesNotMatch(call,/while \(turns\+\+<200\)/);
});

test('department rework completion is durable and First AD coverage is scene-bound', () => {
  const rework=bodyBetween('function crewReworkQueue','function crewPrepareRework');
  const run=bodyBetween('async function crewRun','/** The whole crew, in order, on one idea. */');
  const coverage=bodyBetween('function crewCoverageSceneSatisfies','async function crewWritePrompts');
  assert.match(rework,/function crewCompleteRoleRework/);
  assert.match(rework,/item\.completedAt=completedAt/);
  assert.match(rework,/step\.review\.resolvedAt=completedAt/);
  assert.match(run,/crewCompleteRoleRework\(productionState\(\),role\.id\)/);
  assert.match(coverage,/coverageConstraintKey/);
  assert.match(coverage,/returned coverage for scene/);
  assert.match(coverage,/department\.\'\+role\.id\+\'\.scene\.\'\+sceneId/);
});

test('schema-bound Ollama calls stop cleanly for Muse Glimmer and other reasoning templates', () => {
  const stream=bodyBetween('async function aiStream','/* ---------- scrubbing what the model gives back ---------- */');
  assert.match(stream,/body\.think = false/);
  assert.match(stream,/body\.options\.stop = \['<\|eot\|>','<\|im_end\|>'\]/);
  assert.match(stream,/num_predict:maxTokens/);
  assert.match(stream,/Math\.min\(8192/);
  assert.match(stream,/let out = '', thought = 0/);
  assert.match(stream,/if \(!out\.trim\(\)\)/);
});

test('Greenroom seminars stay agentic without starving the storyboard renderer', () => {
  const seminar=bodyBetween('async function crewChatDevSeminar','function crewGreenroomWorkPacket');
  assert.match(seminar,/shotSeminarRoles/);
  assert.match(seminar,/scenes:seminarScenes,budget:16000,taskFirst:true,collaborationCap:5000/);
  assert.match(seminar,/artifactType:'conversation_plan',maxTokens:512/);
  assert.match(seminar,/artifactType:'conversation_reply',maxTokens:1800/);
  const context=bodyBetween('function crewContext','/* ---------- production state + trusted local service bridge ---------- */');
  assert.match(context,/opts\.taskFirst&&opts\.extra/);
  assert.match(context,/opts\.extra&&!opts\.taskFirst/);
  assert.match(context,/\[earlier Greenroom context omitted\]/);
});

test('long Greenroom agent work renews its exclusive lease before expiry', () => {
  const lease=bodyBetween('function crewStopRoleLease','/* ---------- the actual jobs ---------- */');
  assert.match(lease,/greenroom_renew_role_work/);
  assert.match(lease,/setInterval\(renew,15000\)/);
  assert.match(lease,/lease\.failures>=2/);
  assert.match(lease,/AI\.ctrl\.abort\(\)/);
  const run=bodyBetween('async function crewRun','/** The whole crew, in order, on one idea. */');
  assert.match(run,/crewStartRoleLease\(role,roleWork\)/);
  assert.match(run,/CREW\.roleLease\.lost/);
  assert.match(run,/crewStopRoleLease\(\)/);
});

test('screenplay repair can change scene-heading lines only', () => {
  const repair = bodyBetween('async function repairScriptHeadings', '/** Offer adaptation');
  assert.match(repair, /lineNumber/);
  assert.match(repair, /lines\[index\]!==original/);
  assert.match(repair, /SLUG_RE\.test\(replacement\)/);
  assert.match(repair, /repaired\[index\]=value/);
  assert.match(repair, /Do not rewrite, correct, summarize, join, split, or move any other line/);
  assert.match(repair, /schema:SCRIPT_HEADING_REPAIR_SCHEMA/);
  assert.doesNotMatch(repair, /storyToScript\s*\(/);
});

test('the production run is resumable and queues every stable shot id', () => {
  assert.match(source, /production:\s*null/);
  assert.match(source, /function persistNow\(/);
  const video = bodyBetween('async function crewVideo', 'function crewStatusRows');
  assert.match(video, /studioShotId:sh\.id/);
  assert.match(video, /queue-batch/);
  assert.match(video, /p\.status='rendering'/);
  assert.doesNotMatch(video, /shots\[0\]/);
});

test('queue acknowledgements are not logged as finished takes', () => {
  const queue = bodyBetween('async function crewVideo', 'function crewStatusRows');
  assert.doesNotMatch(queue, /addTake\s*\(/);
  const poll = bodyBetween('async function crewRefreshJobs', 'function crewSchedulePoll');
  assert.match(poll, /job\.status==='done'/);
  assert.match(poll, /addTake\(shotId/);
  assert.match(poll, /jobId:job\.id/);
  assert.match(poll, /data\.missingIds/);
  assert.match(poll, /job\.status='missing'/);
});

test('whole-film pipeline reaches taste, stills, video, and editor', () => {
  const pipeline = bodyBetween('const CREW_PIPELINE', 'async function crewCall');
  for (const role of ['script_supervisor', 'taste', 'stills_prompt', 'stills', 'second_unit', 'editor']) {
    assert.match(pipeline, new RegExp(`['"]${role}['"]`));
  }
  assert.ok(pipeline.indexOf("'stills_prompt'") < pipeline.indexOf("'script_supervisor'"));
  assert.ok(pipeline.indexOf("'script_supervisor'") < pipeline.indexOf("'taste'"));
  assert.ok(pipeline.indexOf("'taste'") < pipeline.indexOf("'stills'"));
});

test('storyboard photos are reviewed and rendered one shot at a time before motion work', () => {
  const routing=bodyBetween('function crewStoryboardCurrentRow','async function crewStillPrompts');
  const prompts=bodyBetween('async function crewStillPrompts','const CREW_BIBLE_SCHEMA');
  const images=bodyBetween('async function crewImages','function crewJobId');
  const readiness=bodyBetween('function crewReadyRoles','const CREW_PRODUCER_DECISION_BASE');
  assert.match(routing,/find\(row=>!boardOf\(row\.sh\)\.frame\)/);
  assert.match(routing,/return 'stills_prompt'/);
  assert.match(routing,/return 'script_supervisor'/);
  assert.match(routing,/return 'taste'/);
  assert.match(routing,/return 'stills'/);
  assert.match(prompts,/No video prompt exists yet/);
  assert.doesNotMatch(prompts,/No prompts yet\. @prompt-writer goes first/);
  assert.match(images,/\.slice\(0,1\)/);
  assert.match(images,/await crewEnsureServices\(\)/);
  assert.match(images,/media gateway did not start/);
  assert.match(images,/activeView\(\)==='boards'/);
  assert.match(images,/await renderBoards\(\)/);
  assert.ok(readiness.indexOf('crewStoryboardNextRole(p)') < readiness.indexOf('CREW_MOTION_PREP_PHASE'));
});

test('the progressive storyboard router cannot skip prompt, craft, taste, or a real frame', () => {
  const rows=[1,2].map(index=>({sc:{num:String(index)},sh:{id:'shot-'+index,board:{desc:'',frame:'',craft:null,taste:null}}}));
  const context={Date,allShots:()=>rows,boardOf:shot=>shot.board};
  vm.createContext(context);
  vm.runInContext(`${bodyBetween('function crewStoryboardCurrentRow','async function crewStillPrompts')}
    globalThis.next=crewStoryboardNextRole; globalThis.current=crewStoryboardCurrentRow;`,context);
  const p={};
  assert.equal(context.next(p),'stills_prompt');
  rows[0].sh.board.desc='A complete photo prompt';
  assert.equal(context.next(p),'script_supervisor');
  rows[0].sh.board.craft={verdict:'pass'};
  assert.equal(context.next(p),'taste');
  rows[0].sh.board.tasteUntrainedAt='receipt';
  assert.equal(context.next(p),'stills');
  rows[0].sh.board.frame='frame-1';
  assert.equal(context.current(p).sh.id,'shot-2');
  assert.equal(context.next(p),'stills_prompt');
});

test('taste evidence is read across the Studio library', () => {
  const taste = bodyBetween('function tasteLibraryStates', 'function tasteBlock');
  assert.match(taste, /DB\.projects/);
  assert.match(taste, /seen\.has\(key\)/);
  assert.match(source, /studio\.taste\.v1/);
});

test('still and video providers are independent, model ids stay user-entered, and runs freeze both choices', () => {
  const providerLayer = bodyBetween('const VIDEO_PROVIDER_KEY', '/** Prevent a project graph');
  assert.match(providerLayer, /IMAGE_PROVIDER_KEY/);
  assert.match(providerLayer, /function videoProviderSelection/);
  assert.match(providerLayer, /function imageProviderSelection/);
  assert.match(providerLayer, /allowsCustomModel/);
  const start = bodyBetween('async function crewStart', 'function crewResumeOwnerMatches');
  assert.match(start, /videoProvider:\{id:videoSelection\.id/);
  assert.match(start, /imageProvider:\{id:imageSelection\.id/);
  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room, /Storyboard photo provider/);
  assert.match(room, /Video provider/);
  assert.match(room, /choose or type any model ID/);
  assert.match(room, /Photo and video engines are independent/);
});

test('canon and TasteOS review gate every image or video provider before spend', () => {
  const providerLayer = bodyBetween('function videoPromptFingerprint', '/** Prevent a project graph');
  assert.match(providerLayer, /craft&&craft\.verdict&&craft\.verdict!=='pass'/);
  assert.match(providerLayer, /taste&&taste\.verdict==='kill'/);
  assert.match(providerLayer, /prompt\.offScript/);
  assert.match(providerLayer, /still prompt has not passed script-supervisor review/);
  assert.match(providerLayer, /craft:craft\?/);
  const images = bodyBetween('async function crewImages', 'function crewJobId');
  const videos = bodyBetween('async function crewVideo', 'function crewStatusRows');
  assert.match(images, /imageReviewEnvelope/);
  assert.match(images, /review\.gate==='blocked'/);
  assert.match(images, /\/api\/image\/generate/);
  assert.match(images, /status:'failed'/);
  assert.doesNotMatch(images, /text-to-video for shots without frames/);
  assert.match(videos, /videoBlockedShots\(submissionShots\)/);
  assert.match(videos, /missingFrames/);
  assert.match(videos, /will not fall back to text-to-video/);
  assert.match(videos, /if \(!imageDataUrl\) throw new Error/);
  assert.match(videos, /\/api\/video\/queue-batch/);
  assert.match(videos, /review:videoReviewEnvelope\(sh\)/);
});

test('canon audit ignores photographic prose but still catches invented visible entities', () => {
  const auditSource=bodyBetween('const plNorm', '/** Hand the model the exact ranges');
  const context={Set,String,Object,Array,
    SUGGEST:{props:['umbrella','photograph'],vehicles:['plane'],vfx:['floating'],stunts:[],sfx:[],sound:[],animals:[],wardrobe:[],extras:[],setdress:[],makeup:[]},
    PL_CRAFT_WORDS:['photograph','plane'],PL_STOPWORDS:[]};
  vm.createContext(context);
  vm.runInContext(`${auditSource}; globalThis.add=plAddWords; globalThis.audit=plCanonAudit;`,context);
  const vocab=new Set();
  context.add(vocab,'laundromat washing machine red photograph plane');
  assert.deepEqual([...context.audit('SUBJECT photograph surface deformation environment physical state; no floating objects',vocab)],[]);
  assert.deepEqual([...context.audit('A red umbrella sits beside the washing machine.',vocab)],['umbrella']);
});

test('the script supervisor independently reviews storyboard-photo prompts', () => {
  assert.match(source, /const CRITIC_STILL_SPINE/);
  assert.match(source, /STILL-PROMPT RUBRIC/);
  const supervisor = bodyBetween('async function crewSupervise', 'async function crewTaste');
  assert.match(supervisor, /withStill/);
  assert.match(supervisor, /critique\('still'/);
  assert.match(supervisor, /board\.craft=v/);
  assert.match(supervisor, /stillBad/);
  const rework = bodyBetween('async function crewProcessShotReworks', 'function crewTranscriptEntries');
  assert.match(rework, /await crewSupervise\(crewFind\('script_supervisor'\)/);
  assert.match(rework, /await crewTaste\(crewFind\('taste'\)/);
});

test('the still critic cannot delete fields required by the storyboard photo contract', () => {
  const critic=bodyBetween('const CRITIC_STILL_SPINE','/** Deterministic findings the critic must not argue with. */');
  for (const label of ['FILM STOCK','IMPERFECTION','AESTHETIC REFUSALS','AVOID']) assert.match(critic,new RegExp(label));
  assert.match(critic,/Never flag a block merely because it exists/);
  assert.match(critic,/never request that a required block be removed/);
  assert.match(critic,/Calling the artifact a photograph or stating the canonical time of day is allowed/);
  const note=bodyBetween('function critiqueStillToNote','/* ============================================================\n   ⚡⚡ STYLE THE BIBLES');
  assert.match(note,/film stock\|imperfection\|aesthetic refusals\|avoid/);
  assert.match(note,/photograph wording\|time reference/);
  const stills=bodyBetween('async function crewStillPrompts','const CREW_BIBLE_SCHEMA');
  assert.match(stills,/critiqueStillToNote\(board\.craft\)/);
});

test('a binding one-shot-per-scene direction is executable coverage validation', () => {
  const parse = loadFunction('function crewCoverageConstraintText', 'function crewCoverageConstraint(p)', 'crewCoverageConstraintText', {});
  assert.equal(parse('Replace the overcoverage with exactly ONE deliberate static shot per scene, seven shots total.').onePerScene, true);
  assert.equal(parse('Keep the coverage lean and purposeful.').onePerScene, false);
  const satisfies = loadFunction('function crewCoverageSceneSatisfies', 'const CREW_COVERAGE_SCHEMA', 'crewCoverageSceneSatisfies', {});
  assert.equal(satisfies({shots:[{crewPlanned:true}],coverageCheck:'The whole beat is covered.'},{onePerScene:true}),true);
  assert.equal(satisfies({shots:[{crewPlanned:true},{crewPlanned:true}],coverageCheck:'Too many.'},{onePerScene:true}),false);
  assert.equal(satisfies({shots:[{auto:false,humanLocked:true}]},{onePerScene:true}),true);
  assert.equal(satisfies({shots:[{auto:true}]},{onePerScene:true}),false);
  const coverage = bodyBetween('function crewCoverageConstraintText', 'async function crewWritePrompts');
  assert.match(coverage, /coverageSchema\.properties\.shots\.maxItems=1/);
  assert.match(coverage, /Binding human direction requires exactly one shot/);
  assert.match(coverage, /crewCoverageValue\(value,sc,constraint\)/);
  assert.match(coverage, /studio\/coverage-progress@1/);
  assert.match(coverage, /completedSceneIds/);
  assert.match(coverage, /budget:28000/);
  assert.match(coverage, /valid scene checkpoints resumed/);
  assert.match(coverage, /filmmaker-approved coverage/);
});

test('editing an automatic shot makes it binding human direction', () => {
  const wiring = bodyBetween('function wireShotTables()', '/* ================= elements view ================= */');
  assert.match(wiring, /sh\.auto=false; sh\.humanLocked=true/);
});

test('PitchDeck adapter preserves shot identity and timing', () => {
  const adapter = bodyBetween('async function buildPitchDeckProject', 'async function exportToPitchDeck');
  assert.match(adapter, /studioShotId:\s*sh\.id/);
  assert.match(adapter, /durationSeconds:\s*seconds/);
  assert.match(adapter, /minutesToExtract:\s*Math\.max\(1, minutes\.length\)/);
  assert.doesNotMatch(adapter, /Math\.min\(5/);
  const promptWriter = bodyBetween('async function crewWritePrompts', 'async function crewSupervise');
  assert.match(promptWriter, /capabilities\.defaultClipSeconds\|\|capabilities\.defaultSeconds\|\|PL\.seconds/);
  assert.match(promptWriter, /\['idea','adaptation'\]\.includes\(p\.mode\)/);
  assert.match(promptWriter, /targetSeconds\/Math\.max\(1,shotCount\)/);
  assert.match(promptWriter, /Script mode[\s\S]*length is not rewritten to fit the new-film target control/);
  assert.doesNotMatch(promptWriter, /target:'seedance',seconds:5/);
  const video = bodyBetween('async function crewVideo', 'function crewStatusRows');
  assert.match(video, /await crewEnsureServices\(\)/);
  assert.match(video, /media gateway did not start/);
  assert.match(video, /frames:Math\.round\(seconds\*24\)\+1/);
});

test('Greenroom credentials never return to browser storage', () => {
  assert.doesNotMatch(source, /studio\.crew\.ids/);
  assert.doesNotMatch(source, /display_name:\s*role\.at\s*\+/);
  assert.match(source, /greenroom_open_production_thread/);
  assert.match(source, /greenroom_post_role_step/);
});

test('resume preserves render polling instead of resetting the pipeline to running', () => {
  const resume = bodyBetween('async function crewResume', '/* ---------- the room ---------- */');
  assert.match(resume, /current\.status==='rendering'\s*\|\|\s*current\.status==='assembling'/);
  assert.match(resume, /crewSchedulePoll\(\);\s*return/);
  assert.match(resume, /incompleteAdmission/);
  assert.match(resume, /await crewCall\(current\.brief/);
  const scheduler = bodyBetween('function crewSchedulePoll', 'async function crewEdit');
  assert.match(scheduler, /runId=p\.id, draftId=ACTIVE\.d/);
  assert.match(scheduler, /current\.id!==runId/);
  assert.match(scheduler, /\['rendering','assembling'\]\.includes\(productionState\(\)\.status\)/);
});

test('render queue is checkpointed per stable shot and incomplete films cannot assemble', () => {
  const video = bodyBetween('async function crewVideo', 'function crewStatusRows');
  assert.match(video, /p\.expectedShotIds=shots\.map/);
  assert.match(video, /shots:\[spec\]/);
  assert.match(video, /data\.errors/);
  assert.match(video, /productionCheckpoint\(\)/);
  const poll = bodyBetween('async function crewRefreshJobsOnce', 'function crewSchedulePoll');
  assert.match(poll, /providerIds\.slice\(i,i\+500\)/);
  const edit = bodyBetween('async function crewEditOnce', '/** Run one department. */');
  assert.match(edit, /expectedShotIds/);
  assert.match(edit, /expected\.filter\(id=>!jobs\[id\]\)/);
  assert.doesNotMatch(edit, /filter\(Boolean\)/);
});

test('automated prompt writing ignores stale UI scope and refuses partial output', () => {
  const prompts = bodyBetween('async function crewWritePrompts', 'async function crewSupervise');
  assert.match(prompts, /scope:'all'/);
  assert.match(prompts, /range:''/);
  assert.match(prompts, /redo:false/);
  assert.match(prompts, /Prompt generation is incomplete/);
});

test('render and assembly are single-flight and lock conflicting production actions', () => {
  assert.match(source, /refreshPromise:null, assemblyPromise:null,[\s\S]*resumePromise:null,[\s\S]*calling:false/);
  assert.match(source, /if \(CREW\.refreshPromise\) return CREW\.refreshPromise/);
  assert.match(source, /if \(CREW\.assemblyPromise\) return CREW\.assemblyPromise/);
  assert.match(bodyBetween('function loadProject(json)', '/* ---------- projects view ---------- */'), /crewMutationLocked\(\)/);
  const bridgeListener = bodyBetween("window.addEventListener('message',event=>", 'return { mount, corkProject');
  assert.match(bridgeListener, /crewMutationLocked\(\)/);
  assert.match(bridgeListener, /crewCanonicalLocked\(\)/);
  const draftSwitch = bodyBetween('function openDraft(pid, did)', '/* ================= utils ================= */');
  assert.match(draftSwitch, /crewActivateLoadedProduction\(\)/);
  const lifecycle = bodyBetween('function crewRecoverInterruptedProduction', 'function crewApplyMutationLock');
  assert.match(lifecycle, /\['starting','running'\]\.includes\(p\.status\)/);
  assert.match(lifecycle, /p\.status='paused'/);
  assert.match(lifecycle, /clearTimeout\(CREW\.pollTimer\)/);
  assert.match(lifecycle, /crewEnsureServices\(\)\.then\(\(\)=>crewSchedulePoll\(1200\)\)/);
  const mutationUi = bodyBetween('function crewApplyMutationLock', '/* dept, and for each role');
  assert.match(mutationUi, /button\.disabled=false/);
  assert.match(mutationUi, /production-readonly/);
  assert.match(mutationUi, /data-review-flag/);
  assert.match(mutationUi, /title\.disabled=locked\|\|canonical/);
  const bootstrap = bodyBetween('(function init(){', '</script>');
  assert.match(bootstrap, /crewActivateLoadedProduction\(\)/);
  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room, /const active=crewMutationLocked\(\)/);
});

test('service startup is single-flight in the webview and model choice remains user-controlled', async () => {
  let starts = 0;
  let connects = 0;
  const context = {
    console, Promise, String,
    CREW: { startPromise: null, startResults: [] },
    crewInvoke: async () => { starts++; return []; },
    setTimeout: callback => { callback(); return 1; },
    crewConnect: async () => {
      connects++;
      return { ollama: { ok: true }, greenroom: { ok: true }, pitchdeck: { ok: true } };
    }
  };
  const ensure = loadFunction('async function crewEnsureServices', 'function productionState', 'crewEnsureServices', context);
  const first = ensure();
  const second = ensure();
  await Promise.all([first, second]);
  assert.equal(starts, 0, 'healthy services must not be redundantly launched');
  assert.equal(connects, 1, 'concurrent callers must share one health/start owner');
  assert.equal(context.CREW.startPromise, null);
  const ensureSource = bodyBetween('async function crewEnsureServices', 'function productionState');
  assert.match(ensureSource, /CREW\.startPromise=null/);
  assert.match(ensureSource, /activeView\(\)==='crew'/);

  const room = bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room, /AI\.models\.map\(model/);
  assert.match(room, /AI\.model=event\.target\.value; aiSave\(\)/);
  const connect = bodyBetween('async function aiConnect', 'function aiController');
  assert.match(connect, /if \(!AI\.model \|\| !hit\.models\.includes\(AI\.model\)\)/);
});

test('manual Greenroom agent work repairs a stale offline connection before it fails', async () => {
  let checks = 0;
  let starts = 0;
  const connected = {
    console, String,
    CREW: { online: false, services: {}, startResults: [] },
    crewConnect: async () => {
      checks++;
      connected.CREW.services={greenroom:{ok:true}};
      connected.CREW.online=true;
      return connected.CREW.services;
    },
    crewEnsureServices: async () => { starts++; return {greenroom:{ok:true}}; }
  };
  const requireGreenroom=loadFunction(
    'async function crewRequireGreenroom',
    'async function crewEnsureServices',
    'crewRequireGreenroom',
    connected
  );
  assert.equal(await requireGreenroom(),true);
  assert.equal(checks,1,'a stale offline flag must trigger a live health check');
  assert.equal(starts,0,'an already-running Greenroom must not be launched again');

  const claim=bodyBetween('async function crewClaimRoleWork','function crewStopRoleLease');
  const open=bodyBetween('async function crewOpenRecord','/** File every handoff');
  assert.match(claim,/await crewRequireGreenroom\(\)/);
  assert.match(open,/await crewRequireGreenroom\(\)/);
  assert.doesNotMatch(claim,/if \(!CREW\.online\) throw/);
});

test('Client Room shows live model activity until the validated agent checkpoint exists', () => {
  const stream=bodyBetween('/** Stream one completion.', '/* ---------- scrubbing what the model gives back ---------- */');
  assert.match(stream,/crewLiveActivity\(opts,'connecting',0,true\)/);
  assert.match(stream,/crewLiveActivity\(opts,'drafting',out\.length\)/);
  assert.match(stream,/crewLiveActivity\(opts,'validating',out\.length,true\)/);
  const room=bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room,/id="crewLiveActivity"/);
  assert.match(room,/crewLiveActivityText\(p\.currentStep\)/);
  const run=bodyBetween('async function crewRun', 'async function crewFillMissingLook');
  assert.match(run,/CREW\.live&&CREW\.live\.roleId===role\.id/);
});

test('Client Room controls survive transcript rerenders through one delegated controller', () => {
  const client = bodyBetween('function clientTranscriptHtml', '/* ================= render all + init ================= */');
  assert.match(client, /function wireClientRoom\(wrap\)/);
  assert.match(client, /if \(!wrap \|\| wrap\._clientRoomWired\) return/);
  assert.match(client, /wrap\.addEventListener\('click',async event=>/);
  assert.match(client, /button\.id==='clientSend'/);
  assert.match(client, /button\.dataset\.clientRevise/);
  assert.match(client, /wireClientRoom\(wrap\)/);
  assert.doesNotMatch(client, /querySelectorAll\('\[data-client-revise\]'\)\.forEach/);
});

test('individual department controls explain an active-pipeline block instead of swallowing clicks', () => {
  const room=bodyBetween('function renderCrew', '/* ================= render all + init ================= */');
  assert.match(room,/id="crewDepartmentControls"/);
  assert.match(room,/CREW\.departmentsOpen\?' open'/);
  assert.match(room,/addEventListener\('toggle'/);
  assert.match(room,/scrollIntoView\(\{block:'start',behavior:'smooth'\}\)/);
  assert.match(room,/Why unavailable/);
  assert.match(room,/data-crew-blocked="1"/);
  assert.doesNotMatch(room,/data-crew="'\+r\.id\+'"'\+\(active\?' disabled'/);
  const handler=room.slice(room.indexOf("w.querySelectorAll('[data-crew]')"));
  assert.match(handler,/if \(crewMutationLocked\(\)\)/);
  assert.match(handler,/Individual departments cannot start while/);
  assert.ok(handler.indexOf('crewMutationLocked()') < handler.indexOf('crewRun(b.dataset.crew'));
});

test('standalone AI work and delayed style-guide reads cannot cross project ownership', () => {
  const workerLock = bodyBetween('function canonicalWorkerLocked', 'function crewMutationLocked');
  assert.match(workerLock, /AI\.status==='probing' \|\| AI\.ctrl/);
  const controller = bodyBetween('function aiController', 'function aiCancel');
  assert.match(controller, /crewApplyMutationLock\(\)/);
  const pdf = bodyBetween('async function handlePDF', '/* ---------- style guide');
  assert.match(pdf, /await pdfExtract/);
  assert.match(pdf, /fileLoadStillOwned\(owner\)/);
  const style = bodyBetween('function importStyleGuide', "el('btnImport')");
  assert.match(style, /owner && !fileLoadStillOwned\(owner\)/);
  assert.match(style, /return false/);
});

test('Greenroom thread messages remain provenance-only and posts are ordered', () => {
  assert.match(source, /function crewMergeRecord/);
  const merge = bodyBetween('function crewMergeRecord', 'async function crewOpenRecord');
  assert.match(merge, /p\.greenroomSteps\[roleId\]/);
  assert.match(merge, /provenanceOnly:true/);
  assert.doesNotMatch(merge, /p\.steps\[roleId\]\s*=/);
  const run = bodyBetween('async function crewRun', '/** The whole crew, in order, on one idea. */');
  assert.match(run, /await crewClaimRoleWork/);
  assert.match(run, /await crewFinalizeRoleWork/);
  assert.ok(run.indexOf('await crewClaimRoleWork') < run.indexOf("productionStep(role.id,'running'"));
  assert.ok(run.indexOf('productionStep(role.id,status') < run.indexOf('await crewFinalizeRoleWork'));
  assert.match(source, /greenroom_claim_role_work/);
  assert.match(source, /greenroom_ack_role_work/);
  const record = bodyBetween('async function crewRecord', 'function crewGreenroomRoleId');
  assert.match(record, /roleId:crewGreenroomRoleId\(role\)/);
  const roleContext = {};
  const greenroomRoleId = loadFunction('function crewGreenroomRoleId', 'function crewGreenroomWorkPacket', 'crewGreenroomRoleId', roleContext);
  assert.equal(greenroomRoleId({id:'story_review',greenroomRoleId:'story_editor'}),'story_editor');
  assert.equal(greenroomRoleId({id:'stills_prompt'}),'prompt_writer');
});

test('synthetic screenplay review records TasteOS evidence as the canonical story editor', () => {
  const context = {
    String,
    productionState: () => ({ currentStep: 'story_review' }),
    crewFind: id => id === 'story_review'
      ? { id: 'story_review', skillRoleId: 'story_editor', greenroomRoleId: 'story_editor' }
      : null,
    crewSkillBook: () => ({ name: 'Story editor', version: '1.0.0' })
  };
  const identity = loadFunction('function tasteWorkloadIdentity', 'async function tasteWorkloadStart', 'tasteWorkloadIdentity', context);
  const result = identity({ roleId: 'story_review', workloadId: 'department.story_editor.screenplay_review.0' });
  assert.equal(result.roleId, 'story_editor');
  assert.equal(result.requestedRoleId, 'story_review');
  assert.equal(result.workloadId, 'department.story_editor.screenplay_review.0');
});

test('live resume returns to polling without rerunning departments', async () => {
  const production = { id: 'run-1', status: 'rendering', jobs: { shot: { id: 'job-1', status: 'running' } }, brief: 'film' };
  let polls = 0;
  let calls = 0;
  const context = {
    console, Object,
    ACTIVE: { p: 'project-1', d: 'draft-1' },
    CREW: { busy: '', calling: false, refreshPromise: null, assemblyPromise: null, resumePromise: null, resumeOwner: '' },
    canonicalWorkerLocked: () => false,
    crewUnprovenJobs: () => [],
    crewShotReworkQueue: () => [],
    crewProcessShotReworks: async () => {},
    productionState: () => production,
    crewEnsureServices: async () => {},
    tasteLoadSnapshot: async () => ({}),
    crewOpenRecord: async () => {},
    crewRefreshJobs: async () => {},
    crewSchedulePoll: () => { polls++; },
    crewCall: async () => { calls++; },
    productionCheckpoint: () => {},
    crewApplyMutationLock: () => {},
    activeView: () => 'crew',
    renderCrew: () => {}
  };
  const resume = loadFunction('function crewResumeOwnerMatches', '/* ---------- the room ---------- */', 'crewResume', context);
  await resume();
  assert.equal(polls, 1);
  assert.equal(calls, 0);
  assert.equal(production.status, 'rendering');
});

test('resume owns one draft across service awaits and cannot spill into another project', async () => {
  const runA = { id: 'run-a', status: 'paused', jobs: {}, brief: 'A film' };
  const runB = { id: 'run-b', status: 'paused', jobs: {}, brief: 'B film' };
  let current = runA;
  let releaseServices;
  let opened = 0;
  let calls = 0;
  const context = {
    console, Object, Number, String,
    ACTIVE: { p: 'project-a', d: 'draft-a' },
    CREW: { busy: '', calling: false, refreshPromise: null, assemblyPromise: null, resumePromise: null, resumeOwner: '' },
    canonicalWorkerLocked: () => false,
    crewUnprovenJobs: () => [],
    productionState: () => current,
    crewEnsureServices: () => new Promise(resolve => { releaseServices = resolve; }),
    tasteLoadSnapshot: async () => ({}),
    crewOpenRecord: async () => { opened++; },
    crewRefreshJobs: async () => {},
    crewSchedulePoll: () => {},
    crewCall: async () => { calls++; },
    productionCheckpoint: () => {},
    crewApplyMutationLock: () => {},
    activeView: () => 'projects',
    renderCrew: () => {}
  };
  const resume = loadFunction('function crewResumeOwnerMatches', '/* ---------- the room ---------- */', 'crewResume', context);
  const work = resume();
  assert.ok(context.CREW.resumePromise, 'resume must acquire its in-memory owner lock before yielding');
  current = runB;
  context.ACTIVE.p = 'project-b';
  context.ACTIVE.d = 'draft-b';
  releaseServices();
  await work;
  assert.equal(opened, 0);
  assert.equal(calls, 0);
  assert.equal(context.CREW.resumePromise, null);
});

test('an ambiguous render manifest stays immutable until it is archived read-only', () => {
  const production = {
    id: 'run-ambiguous', status: 'needs_attention', expectedShotIds: ['shot-a'],
    jobs: { 'shot-a': { id: '', status: 'failed', attempt: 0, error: 'response lost' } }
  };
  const context = {
    console, Object, JSON, Date,
    S: { production, productionHistory: [] },
    CREW: { busy: '', calling: false, refreshPromise: null, assemblyPromise: null, resumePromise: null, pollTimer: null, pollOwner: '' },
    productionState: () => context.S.production,
    crewMutationLocked: () => false,
    persistNow: () => true,
    crewApplyMutationLock: () => {},
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${bodyBetween('function crewCanonicalLocked', '/** A webview restart')}\n`
    + 'globalThis.__lock=crewCanonicalLocked;globalThis.__archive=crewArchiveRenderForRevision;', context);
  assert.equal(context.__lock(), true, 'a lost queue receipt can still represent accepted external work');
  assert.equal(context.__archive(), true);
  assert.equal(context.S.production, null, 'an archived manifest must not remain resumable');
  assert.equal(context.S.productionHistory.length, 1);
  assert.equal(context.S.productionHistory[0].jobs['shot-a'].attempt, 0);
  assert.equal(context.S.productionHistory[0].renderManifestAbandonedAt, context.S.productionHistory[0].archivedAt);
  assert.equal(context.__lock(), false);
});

test('Pause invalidates an already-fired render reconciliation and releases the UI lock', async () => {
  const production = {
    id: 'run-pause', status: 'rendering', pollEpoch: 0, expectedShotIds: ['shot-a'],
    jobs: { 'shot-a': { id: 'job-a', status: 'running' } }
  };
  let releaseStatus;
  let edits = 0;
  let lockRefreshes = 0;
  let roomRenders = 0;
  const context = {
    console, Object, Array, Map, Set, String, Number, Math, Date, AbortController,
    CREW: { refreshPromise: null, reconcileCtrl: null },
    productionState: () => production,
    crewJobs: () => production.jobs,
    allShots: () => [],
    crewFetchJson: () => new Promise(resolve => { releaseStatus = resolve; }),
    addTake: () => {},
    crewMediaUrl: () => '',
    productionCheckpoint: () => true,
    crewFind: () => ({}),
    crewEdit: async () => { edits++; },
    crewRecord: async () => {},
    crewApplyMutationLock: () => { lockRefreshes++; },
    activeView: () => 'crew',
    renderCrew: () => { roomRenders++; },
    ...providerStubs()
  };
  const refresh = loadFunction('function crewStatusRows', 'function crewSchedulePoll', 'crewRefreshJobs', context);
  const work = refresh();
  production.pollEpoch += 1;
  production.status = 'paused';
  releaseStatus({ jobs: [{ id: 'job-a', status: 'done' }] });
  const result = await work;
  assert.equal(result.stale, true);
  assert.equal(production.status, 'paused');
  assert.equal(production.jobs['shot-a'].status, 'running');
  assert.equal(edits, 0);
  assert.equal(context.CREW.refreshPromise, null);
  assert.ok(lockRefreshes > 0 && roomRenders > 0, 'settled stale work must visibly release Resume and navigation');
});

test('Pause aborts a direct Editor wait and ignores its late assembly result', async () => {
  const production = {
    id: 'run-editor-pause', status: 'needs_attention', pollEpoch: 0,
    expectedShotIds: ['shot-a'], jobs: { 'shot-a': { id: 'job-a', status: 'done' } }
  };
  const context = {
    console, Object, Array, String, Number, JSON, Date, Error, AbortController,
    S: { title: 'Film', cut: null },
    CREW: { assemblyPromise: null, reconcileCtrl: null },
    productionState: () => production,
    crewJobs: () => production.jobs,
    allShots: () => [],
    crewRefreshOwnerMatches: (runId, epoch) => production.id === runId && production.pollEpoch === epoch,
    crewFetchJson: (_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    productionCheckpoint: () => true,
    crewSchedulePoll: () => {},
    productionStep: () => true,
    crewApplyMutationLock: () => {},
    activeView: () => 'projects',
    renderCrew: () => {},
    ...providerStubs()
  };
  const edit = loadFunction('async function crewEdit', '/** Run one department. */', 'crewEdit', context);
  const work = edit({ id: 'editor' }, 'finish');
  assert.ok(context.CREW.assemblyPromise);
  assert.ok(context.CREW.reconcileCtrl);
  production.pollEpoch += 1;
  production.status = 'paused';
  context.CREW.reconcileCtrl.abort();
  const result = await work;
  assert.equal(result.status, 'waiting');
  assert.equal(context.S.cut, null);
  assert.equal(production.status, 'paused');
  assert.equal(context.CREW.assemblyPromise, null);
  assert.equal(context.CREW.reconcileCtrl, null);
});

test('render admission fails closed when its pending attempt cannot be saved', async () => {
  const production = { id: 'run-storage-full', status: 'running', jobs: {} };
  const shots = [{ sc: { num: '1' }, sh: { id: 'shot-a', num: '1A', board:{frame:'frame-a'}, prompt: { text: 'A', seconds: 5 } } }];
  let checkpoints = 0;
  let externalCalls = 0;
  const context = {
    console, Date, String, Math, JSON, Error, Promise,
    CREW: { cancel: false },
    S: { title: 'Film' }, PL: { seconds: 5 },
    allShots: () => shots,
    productionState: () => production,
    crewJobs: () => production.jobs,
    boardOf: sh => sh.board,
    pdFrameDataUrl: async () => 'data:image/png;base64,AA==',
    crewJobId: value => value && value.id,
    crewFetchJson: async () => { externalCalls++; return { ok: true, jobs: [{ id: 'should-not-exist' }] }; },
    productionCheckpoint: () => ++checkpoints === 1,
    crewSchedulePoll: () => {},
    ...providerStubs()
  };
  const queue = loadFunction('async function crewVideo', 'function crewStatusRows', 'crewVideo', context);
  await assert.rejects(queue({}, ''), /could not save the pending render attempt/i);
  assert.equal(externalCalls, 0);
  assert.equal(production.jobs['shot-a'].status, 'admitting');
});

test('a department result must be durable before provenance or later work continues', async () => {
  const production = { id: 'run-durable-step', status: 'paused', steps: {} };
  let checkpoints = 0;
  let records = 0;
  const role = { id: 'director', at: 'director', act: 'look:tone', blocked: false };
  const context = {
    console, Object, String, JSON, Date,
    ACTIVE: { p: 'project-a', d: 'draft-a' },
    CREW: { busy: '', calling: false, cancel: false, last: {} },
    AI: { status: 'on' }, S: { title: 'Film' }, window: {},
    crewFind: () => role,
    canonicalWorkerLocked: () => false,
    productionState: () => production,
    crewApplyMutationLock: () => {}, activeView: () => 'projects', renderCrew: () => {}, toast: () => {},
    aiConnect: async () => true,
    tasteLoadSnapshot: async () => ({}),
    productionStep: (id, status, out, error) => {
      production.steps[id] = { status, out, error };
      checkpoints++;
      return checkpoints === 1;
    },
    crewLookJob: async () => 'look written', crewBibleJob: async () => '', crewImages: async () => '', crewVideo: async () => '',
    crewArtifactForRole: () => null,
    crewClaimRoleWork: async () => ({ id: 'work-id' }),
    crewFinalizeRoleWork: async () => { records++; return true; },
    crewEnsureCurrentProject: () => {}, productionCheckpoint: () => true,
    uid: () => 'id'
  };
  const run = loadFunction('/** Run one department. */', '/** The whole crew, in order, on one idea. */', 'crewRun', context);
  const result = await run('director', 'brief');
  assert.equal(result.status, 'failed');
  assert.match(result.out, /could not save @director/i);
  assert.equal(records, 0, 'Greenroom must not claim an unsaved canonical result');
  assert.equal(production.status, 'needs_attention');
});

test('an unproven Phosphene submission requires explicit durable authorization', () => {
  const production = {
    id: 'run-uncertain', status: 'needs_attention',
    jobs: { 'shot-a': { id: '', status: 'failed', attempt: 0, code: 'PHOSPHENE_SUBMISSION_UNPROVEN' } }
  };
  const context = {
    console, Object, JSON, Date,
    productionState: () => production,
    crewMutationLocked: () => false,
    productionCheckpoint: () => true,
    crewApplyMutationLock: () => {}, toast: () => {}
  };
  vm.createContext(context);
  vm.runInContext(`${bodyBetween("const CREW_UNPROVEN_CODE", 'function crewMediaUrl')}\n`
    + 'globalThis.__uncertain=crewUnprovenJobs;globalThis.__authorize=crewAuthorizeUnprovenAttempts;', context);
  assert.equal(context.__uncertain(production).length, 1);
  assert.equal(context.__authorize(), true);
  assert.equal(production.jobs['shot-a'].retryAuthorized, true);
  assert.ok(production.jobs['shot-a'].retryAuthorizedAt);
  assert.equal(context.__uncertain(production).length, 0);
});

test('a manual department owns the draft before AI probing and consumes its own Stop', async () => {
  const production = { id: 'run-manual', status: 'paused', steps: {} };
  const connectResolvers = [];
  let jobs = 0;
  const role = { id: 'director', at: 'director', act: 'look:tone', blocked: false };
  const context = {
    console, Object, String, JSON, Date,
    ACTIVE: { p: 'project-a', d: 'draft-a' },
    CREW: { busy: '', calling: false, cancel: false, last: {} },
    AI: { status: 'off' },
    S: { title: 'Film' },
    window: {},
    canonicalWorkerLocked: () => false,
    crewFind: () => role,
    productionState: () => production,
    crewApplyMutationLock: () => {},
    activeView: () => 'projects',
    renderCrew: () => {},
    toast: () => {},
    aiConnect: () => new Promise(resolve => { connectResolvers.push(resolve); }),
    tasteLoadSnapshot: async () => ({}),
    productionStep: (id, status, out, error) => { production.steps[id] = { status, out, error }; return true; },
    crewLookJob: async () => { jobs++; return 'look'; },
    crewArtifactForRole: () => null,
    crewBibleJob: async () => '',
    crewImages: async () => '',
    crewVideo: async () => '',
    crewClaimRoleWork: async () => ({ id: 'work-id' }),
    crewFinalizeRoleWork: async () => true,
    crewCompleteRoleRework: () => 0,
    crewEnsureCurrentProject: () => {},
    productionCheckpoint: () => true,
    uid: () => 'id'
  };
  const run = loadFunction('/** Run one department. */', '/** The whole crew, in order, on one idea. */', 'crewRun', context);

  const first = run('director', 'A');
  assert.equal(context.CREW.busy, 'director');
  const duplicate = await run('director', 'duplicate');
  assert.equal(duplicate.status, 'busy');
  context.ACTIVE.d = 'draft-b';
  while (!connectResolvers.length) await Promise.resolve();
  connectResolvers.shift()(true);
  assert.equal((await first).status, 'cancelled');
  assert.equal(jobs, 0);
  assert.equal(context.CREW.busy, '');

  context.ACTIVE.d = 'draft-a';
  const stopped = run('director', 'B');
  while (!connectResolvers.length) await Promise.resolve();
  context.CREW.cancel = true;
  connectResolvers.shift()(true);
  assert.equal((await stopped).status, 'cancelled');
  assert.equal(context.CREW.cancel, false, 'manual Stop must not poison the next run');

  context.AI.status = 'on';
  const final = await run('director', 'C');
  assert.equal(final.status, 'done');
  assert.equal(jobs, 1);
});

test('a direct media department cannot leave its synthetic production permanently running', async () => {
  let role = { id: 'stills', at: 'stills', act: 'image', blocked: false };
  let serial = 0;
  const context = {
    console, Object, String, JSON, Date,
    ACTIVE: { p: 'project-a', d: 'draft-a' },
    CREW: { busy: '', calling: false, cancel: false, last: {} },
    AI: { status: 'on' },
    S: { title: 'Film', production: null },
    window: { crewEdit: async () => { throw new Error('no cut manifest'); } },
    canonicalWorkerLocked: () => false,
    crewFind: () => role,
    productionState: () => context.S.production,
    crewApplyMutationLock: () => {},
    activeView: () => 'projects',
    renderCrew: () => {},
    toast: () => {},
    aiConnect: async () => true,
    tasteLoadSnapshot: async () => ({}),
    productionStep: (id, status, out, error) => {
      const p = context.S.production;
      if (!p) return true;
      p.steps[id] = { status, out, error };
      return true;
    },
    crewLookJob: async () => '',
    crewArtifactForRole: () => null,
    crewBibleJob: async () => '',
    crewImages: async () => ({ status: 'skipped', text: 'still engine unavailable' }),
    crewVideo: async () => '',
    crewClaimRoleWork: async () => ({ id: 'work-id' }),
    crewFinalizeRoleWork: async () => true,
    crewCompleteRoleRework: () => 0,
    crewEnsureCurrentProject: () => {},
    productionCheckpoint: () => true,
    uid: () => `id-${++serial}`
  };
  const run = loadFunction('/** Run one department. */', '/** The whole crew, in order, on one idea. */', 'crewRun', context);

  const stills = await run('stills', 'one frame');
  assert.equal(stills.status, 'skipped');
  assert.equal(context.S.production.status, 'paused');
  assert.equal(context.CREW.busy, '');

  context.S.production = null;
  role = { id: 'editor', at: 'editor', act: 'run:crewEdit', blocked: false };
  const editor = await run('editor', 'cut it');
  assert.equal(editor.status, 'failed');
  assert.equal(context.S.production.status, 'needs_attention');
  assert.match(context.S.production.error, /no cut manifest/);
  assert.equal(context.CREW.busy, '');
});

test('stopping an in-flight department cancels cleanly instead of becoming a false failure', async () => {
  const production = { id: 'run-stop', status: 'running', steps: {}, brief: 'film' };
  const messages = [];
  const context = {
    console,
    CREW: { busy: '', calling: false, cancel: false },
    CREW_PIPELINE: ['prompt_writer'],
    crewReworkQueue: () => [],
    crewPrepareRework: () => true,
    productionState: () => production,
    crewReadyRoles: p => p.steps.prompt_writer?.status === 'done' ? [] : ['prompt_writer'],
    crewRun: async () => {
      context.CREW.cancel = true;
      return { ok: false, status: 'failed', out: 'AbortError' };
    },
    allShots: () => [],
    crewLoopTicket: () => ({ ok: true, key: 'prompt_writer:project', fingerprint: 'before', failures: 0 }),
    crewLoopRecord: () => ({ progressed: true }),
    productionStep: (id, status, out, error) => { production.steps[id] = { status, out, error }; },
    productionCheckpoint: () => {},
    crewFind: () => ({ at: 'prompt-writer' }),
    crewSchedulePoll: () => {},
    crewApplyMutationLock: () => {},
    activeView: () => 'crew',
    renderCrew: () => {},
    toast: value => messages.push(value)
  };
  const call = loadFunction('async function crewCall', 'async function crewStart', 'crewCall', context);
  await call('film');
  assert.equal(production.status, 'cancelled');
  assert.equal(production.steps.prompt_writer.status, 'waiting');
  assert.doesNotMatch(messages.join('\n'), /needs attention/i);

  production.status = 'running';
  production.steps = {};
  context.crewRun = async () => {
    production.steps.prompt_writer = { status: 'done', out: 'finished mutation' };
    context.CREW.cancel = true;
    return { ok: true, status: 'done', out: 'finished mutation' };
  };
  await call('film');
  assert.equal(production.status, 'cancelled');
  assert.equal(production.steps.prompt_writer.status, 'done', 'Stop during provenance must not rerun completed work');
});

test('a persisted running production becomes resumable after its webview restarts', () => {
  const production = {
    id: 'run-reload', status: 'running', currentStep: 'writer',
    steps: { writer: { status: 'running', error: 'stale' } }
  };
  let saves = 0;
  const context = {
    console, Date,
    CREW: { busy: '', calling: false },
    productionState: () => production,
    persistNow: () => { saves++; return true; }
  };
  const recover = loadFunction(
    'function crewRecoverInterruptedProduction',
    '/** Transfer the one poll owner',
    'crewRecoverInterruptedProduction',
    context
  );
  assert.equal(recover(), true);
  assert.equal(production.status, 'paused');
  assert.equal(production.currentStep, '');
  assert.equal(production.steps.writer.status, 'waiting');
  assert.equal(saves, 1);
});

test('a partial queue response persists the failed shot instead of dropping it from the film', async () => {
  const production = { id: 'run-2', status: 'running', jobs: {} };
  const shots = [
    { sc: { num: '1' }, sh: { id: 'shot-a', num: '1A', board:{frame:'frame-a'}, prompt: { text: 'A', seconds: 5 } } },
    { sc: { num: '1' }, sh: { id: 'shot-b', num: '1B', board:{frame:'frame-b'}, prompt: { text: 'B', seconds: 5 } } }
  ];
  let checkpoints = 0;
  const context = {
    console, Date, String, Math, JSON, Error, Promise,
    CREW: { cancel: false },
    S: { title: 'Film' }, PL: { seconds: 5 },
    allShots: () => shots,
    productionState: () => production,
    crewJobs: () => production.jobs,
    boardOf: sh => sh.board,
    pdFrameDataUrl: async sh => 'data:image/png;base64,'+sh.id,
    crewJobId: (value) => value && (value.id || value.job?.id),
    crewFetchJson: async (_path, options) => {
      const id = JSON.parse(options.body).shots[0].studioShotId;
      return id === 'shot-a'
        ? { ok: true, jobs: [{ studioShotId: id, id: 'job-a' }], errors: [] }
        : { ok: false, jobs: [], errors: [{ studioShotId: id, error: 'bad prompt' }] };
    },
    productionCheckpoint: () => { checkpoints++; },
    crewSchedulePoll: () => {},
    ...providerStubs()
  };
  const queue = loadFunction('async function crewVideo', 'function crewStatusRows', 'crewVideo', context);
  const result = await queue({}, '');
  assert.equal(result.status, 'waiting');
  assert.deepEqual(production.expectedShotIds, ['shot-a', 'shot-b']);
  assert.equal(production.jobs['shot-a'].id, 'job-a');
  assert.equal(production.jobs['shot-b'].status, 'failed');
  assert.match(production.jobs['shot-b'].error, /bad prompt/);
  assert.ok(checkpoints >= 3);
});

test('Stop during queue admission checkpoints accepted jobs and pauses before the next shot', async () => {
  const production = { id: 'run-stop-queue', status: 'running', jobs: {} };
  const shots = [
    { sc: { num: '1' }, sh: { id: 'shot-a', num: '1A', board:{frame:'frame-a'}, prompt: { text: 'A', seconds: 5 } } },
    { sc: { num: '1' }, sh: { id: 'shot-b', num: '1B', board:{frame:'frame-b'}, prompt: { text: 'B', seconds: 5 } } }
  ];
  let polls = 0;
  const context = {
    console, Date, String, Math, JSON, Error, Promise,
    CREW: { cancel: false },
    S: { title: 'Film' }, PL: { seconds: 5 },
    allShots: () => shots,
    productionState: () => production,
    crewJobs: () => production.jobs,
    boardOf: sh => sh.board,
    pdFrameDataUrl: async sh => 'data:image/png;base64,'+sh.id,
    crewJobId: value => value && (value.id || value.job?.id),
    crewFetchJson: async (_path, options) => {
      const spec = JSON.parse(options.body).shots[0];
      context.CREW.cancel = true;
      return { ok: true, jobs: [{ studioShotId: spec.studioShotId, id: 'job-a' }] };
    },
    productionCheckpoint: () => {},
    crewSchedulePoll: () => { polls++; },
    ...providerStubs()
  };
  const queue = loadFunction('async function crewVideo', 'function crewStatusRows', 'crewVideo', context);
  const result = await queue({}, '');
  assert.equal(result.status, 'waiting');
  assert.equal(production.status, 'paused');
  assert.equal(production.jobs['shot-a'].id, 'job-a');
  assert.equal(production.jobs['shot-b'], undefined);
  assert.deepEqual(production.expectedShotIds, ['shot-a', 'shot-b']);
  assert.equal(polls, 0);
});

test('an ambiguous lost queue receipt reuses its attempt, while a known terminal job advances', async () => {
  const production = {
    id: 'run-retry', status: 'needs_attention',
    jobs: { 'shot-a': { id: '', status: 'failed', attempt: 0, error: 'response lost' } }
  };
  const shots = [
    { sc: { num: '1' }, sh: { id: 'shot-a', num: '1A', board:{frame:'frame-a'}, prompt: { text: 'A', seconds: 5 } } }
  ];
  const attempts = [];
  let serial = 0;
  const context = {
    console, Date, String, Math, JSON, Error, Promise,
    CREW: { cancel: false },
    S: { title: 'Film' }, PL: { seconds: 5 },
    allShots: () => shots,
    productionState: () => production,
    crewJobs: () => production.jobs,
    boardOf: sh => sh.board,
    pdFrameDataUrl: async sh => 'data:image/png;base64,'+sh.id,
    crewJobId: value => value && (value.id || value.job?.id),
    crewFetchJson: async (_path, options) => {
      const spec = JSON.parse(options.body).shots[0];
      attempts.push(spec.attempt);
      serial += 1;
      return { ok: true, jobs: [{ studioShotId: spec.studioShotId, attempt: spec.attempt, id: `job-${serial}` }] };
    },
    productionCheckpoint: () => {},
    crewSchedulePoll: () => {},
    ...providerStubs()
  };
  const queue = loadFunction('async function crewVideo', 'function crewStatusRows', 'crewVideo', context);

  await queue({}, '');
  assert.equal(attempts[0], 0, 'no-id failure must recover the original ledger receipt');

  production.jobs['shot-a'] = { id: 'known-terminal', status: 'failed', attempt: 0, error: 'render failed' };
  await queue({}, '');
  assert.equal(attempts[1], 1, 'a real terminal job must create a fresh render attempt');

  production.jobs['shot-a'] = { id: '', status: 'failed', attempt: 3, retryAuthorized: true };
  await queue({}, '');
  assert.equal(attempts[2], 4, 'explicit authorization must advance an otherwise unproven attempt');
});
