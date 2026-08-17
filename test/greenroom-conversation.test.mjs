import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

function between(start, end) {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`missing ${start} -> ${end}`);
  return source.slice(a,b);
}

test('creative departments consult peers while formal reviewers and tool agents execute without duplicate seminars', () => {
  assert.match(source,/id:'taste', at:'the-eye'/);
  const context=between('function crewContext', '/* ---------- production state + trusted local service bridge ---------- */');
  const run=between('async function crewRun', 'async function crewFillMissingLook');
  assert.match(context,/GREENROOM PEER CONSULTATIONS AND HANDOFFS/);
  assert.match(context,/crewCollaborationContext\(role\)/);
  assert.match(source,/const CREW_DIRECT_EXECUTION_ROLES=new Set\(\['producer','story_review','script_supervisor','taste','stills_prompt','stills','key_grip','composer','prompt_writer','second_unit','editor'\]\)/);
  assert.match(source,/const CREW_TOOL_ONLY_ROLES=new Set\(\['stills','second_unit','editor'\]\)/);
  assert.match(run,/const needsAI = crewUsesLocalModel\(role,a\)/);
  assert.match(run,/await crewEnsureAssignmentHandoff/);
  assert.match(run,/await crewAcknowledgeAssignment/);
  assert.match(run,/crewUsesAgentSeminar\(role,a\)/);
  assert.match(run,/await crewChatDevSeminar/);
  assert.match(run,/await crewSupersedeSkippedSeminar/);
  assert.ok(run.indexOf('await crewChatDevSeminar') < run.indexOf("if (role.blocked"));
});

test('peer conversation accepts substantive prose without weakening canonical artifact schemas', () => {
  const context={String,Array,Error,aiParseJson:value=>JSON.parse(value)};
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(`${between('function crewSeminarReplyFromOutput', 'async function crewChatDevSeminar')}
    globalThis.parseReply=crewSeminarReplyFromOutput;`,context);
  const prose='Keep the camera locked at the established doorway. Preserve the wet tile continuity, avoid a new light source, and hold the same low angle so the cut remains spatially coherent.';
  assert.equal(context.parseReply(prose),prose);
  const structured=context.parseReply(JSON.stringify({
    reply:'Use the doorway obstruction because it turns the established premise into visible behavior inside this exact room.',
    recommendations:['Keep the obstruction inside the established room geometry.'],
    constraints:['Do not add explanatory dialogue.'],blockers:[]
  }));
  assert.match(structured,/Recommendations:/);
  assert.match(structured,/Do not add explanatory dialogue/);
  assert.throws(()=>context.parseReply('Looks good.'),/substantive production ruling/);
  assert.match(source,/schema:replySchema/,'peer requests still ask the model for the bounded schema first');
});

test('a schema-bound agent repairs its own malformed JSON within a finite phase', async () => {
  const prompts=[];
  let attempt=0;
  const context={
    String,Number,Math,Object,Array,Error,Promise,
    crewJsonRepairSystem:()=> 'full role skill book plus JSON contract',
    aiParseJson:value=>JSON.parse(value),
    aiStream:async(system,prompt)=>{
      prompts.push({system,prompt}); attempt++;
      return attempt===1?'{"decision": "ask", broken':JSON.stringify({decision:'proceed',targetRole:'none'});
    }
  };
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(`${between('async function crewJsonAgentCall', 'function crewSeminarReplyFromOutput')}
    globalThis.callAgent=crewJsonAgentCall;`,context);
  const value=await context.callAgent({id:'director',at:'director'},'Choose the next action.',{
    schemaName:'test_schema',artifactType:'test artifact',workloadId:'test.work',maxRepairAttempts:3
  },parsed=>{
    if(parsed.decision!=='proceed') throw new Error('decision must be proceed');
    return parsed;
  });
  assert.equal(value.decision,'proceed');
  assert.equal(attempt,2);
  assert.match(prompts[1].prompt,/REQUIRED SELF-REPAIR PASS 1 OF 2/);
  assert.match(prompts[1].prompt,/VALIDATOR ERROR/);
  assert.match(prompts[1].prompt,/FAILING RESPONSE/);
  assert.doesNotMatch(prompts[1].prompt,/try forever|unbounded/i);
});

test('schema repair never turns cancellation or transport failure into another model call', async () => {
  let attempts=0;
  const context={
    String,Number,Math,Object,Array,Error,Promise,
    crewJsonRepairSystem:()=> 'full role skill book plus JSON contract',
    aiParseJson:value=>JSON.parse(value),
    aiStream:async()=>{ attempts++; throw new Error('Cancelled'); }
  };
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(`${between('async function crewJsonAgentCall', 'function crewSeminarReplyFromOutput')}
    globalThis.callAgent=crewJsonAgentCall;`,context);
  await assert.rejects(()=>context.callAgent({id:'director',at:'director'},'Choose the next action.',{
    schemaName:'test_schema',artifactType:'test artifact',workloadId:'test.work',maxRepairAttempts:3
  }),/Cancelled/);
  assert.equal(attempts,1);
});

test('the exact peer ruling is injected into the canonical department evidence packet', () => {
  const context={
    console,String,Number,Math,Array,Object,Set,
    S:{title:'Film',look:{},bible:'Premise',bibles:{characters:{},locations:{},props:{}},scenes:[]},
    AI:{numCtx:8192},LOOK_FIELDS:[],productionState:()=>({id:'run',mode:'idea',brief:'Make the premise visible.'}),
    crewClientNotes:()=>[],tasteAgentBrief:()=>'',crewFind:id=>({id,at:id}),
    crewCollaborationContext:()=> 'REPLY · @story-editor → @director\nUse the established doorway obstruction; add no dialogue.'
  };
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(`${between('function crewContext', '/* ---------- production state + trusted local service bridge ---------- */')}
    globalThis.buildContext=crewContext;`,context);
  const packet=context.buildContext({id:'director',at:'director'});
  assert.match(packet,/GREENROOM PEER CONSULTATIONS AND HANDOFFS/);
  assert.match(packet,/Use the established doorway obstruction/);
  assert.match(packet,/add no dialogue/);
});

test('producer handoff, peer request, and peer reply are delivered and acknowledged through Greenroom', async () => {
  const production={id:'run-1',greenroomThreadId:'thread-1',steps:{},orchestration:{last:{nextRole:'director',reason:'The story premise is checkpointed.'}}};
  const roles=[
    {id:'producer',at:'producer',title:'Producer',job:'Routes the film.',owns:'production.orchestration'},
    {id:'director',at:'director',title:'Director',job:'Owns intent.',owns:'look.tone'},
    {id:'story_editor',at:'story-editor',title:'Story editor',job:'Owns story logic.',owns:'project.bible'}
  ];
  const calls=[];
  let uidCounter=0, aiCounter=0, saves=0;
  const context={
    console,Date,Math,JSON,String,Number,Boolean,Array,Object,Set,Map,Error,Promise,
    AI:{model:'muse-glimmer:30b'},
    CREW_ALL:roles,
    uid:()=>`id${++uidCounter}`,
    productionState:()=>production,
    crewRequireGreenroom:async()=>true,
    crewOpenRecord:async()=>production.greenroomThreadId,
    productionCheckpoint:()=>{saves++;return true;},
    crewFind:id=>roles.find(role=>role.id===id||role.at===id),
    crewGreenroomRoleId:role=>role.id,
    crewContext:()=> 'canonical film evidence',
    crewJsonRepairSystem:role=>`skill book for ${role.id}`,
    aiParseJson:value=>JSON.parse(value),
    aiStream:async()=>{
      aiCounter++;
      if(aiCounter===1)return JSON.stringify({decision:'proceed',targetRole:'story_editor',question:'Which visible scene action most clearly proves the premise without adding exposition?',why:'The director needs a story-specific ruling before locking the visual intent.'});
      return JSON.stringify({reply:'Use the repeated doorway obstruction in scene two because it converts the premise into visible behavior.',recommendations:['Keep the obstruction inside the established room geometry.'],constraints:['Do not add explanatory dialogue.'],blockers:[]});
    },
    crewInvoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='greenroom_send_conversation'){
        const id=args.request.eventId;
        return {hostId:`host-${id}`,reused:false,message:{id:`message-${id}`,created_at:'2026-08-16T06:00:00Z'},delivery:{id:`delivery-${id}`,message_id:`message-${id}`,status:'claimed'}};
      }
      return {status:'acknowledged'};
    }
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(`${between('const CREW_COLLABORATION_SCHEMA', 'function crewGreenroomWorkPacket')}
    globalThis.api={crewEnsureAssignmentHandoff,crewAcknowledgeAssignment,crewChatDevSeminar,crewCollaborationContext};`,context);

  const work={id:'work-1'};
  await context.api.crewEnsureAssignmentHandoff(roles[1],work,'Make the dread architectural and visible.');
  await context.api.crewAcknowledgeAssignment(roles[1],work);
  const consultation=await context.api.crewChatDevSeminar(roles[1],'Make the dread architectural and visible.',work);

  assert.match(consultation,/doorway obstruction/);
  assert.equal(production.collaboration.schema,'studio/greenroom-collaboration@1');
  assert.equal(JSON.stringify(production.collaboration.events.map(row=>row.eventType)),JSON.stringify(['handoff','request','reply']));
  assert.equal(JSON.stringify(production.collaboration.events.map(row=>row.intent)),JSON.stringify(['handoff','question','fyi']));
  assert.ok(production.collaboration.events.every(row=>row.status==='acknowledged'));
  assert.equal(production.collaboration.events[2].causedByEventId,production.collaboration.events[1].id);
  assert.match(context.api.crewCollaborationContext(roles[1]),/doorway obstruction/);
  assert.equal(calls.filter(row=>row.command==='greenroom_send_conversation').length,3);
  assert.equal(calls.filter(row=>row.command==='greenroom_ack_conversation').length,3);
  assert.equal(aiCounter,2);
  assert.ok(saves>=9,'every external transition and consumed result must be checkpointed');
});

test('a synthetic stills-prompt handoff mentions only its canonical Greenroom recipient', async () => {
  const production={id:'run-1',greenroomThreadId:'thread-1',steps:{},orchestration:{last:{nextRole:'stills_prompt',reason:'The next storyboard shot needs its photo prompt.'}}};
  const roles=[
    {id:'producer',at:'producer',title:'Producer',job:'Routes the film.',owns:'production.orchestration'},
    {id:'prompt_writer',at:'prompt-writer',title:'Prompt writer (video)',job:'Writes video prompts.',owns:'shots[].prompt'},
    {id:'stills_prompt',at:'stills-prompt',title:'Prompt writer (stills)',job:'Writes storyboard photo prompts.',owns:'shots[].board.desc',greenroomRoleId:'prompt_writer'}
  ];
  let sent;
  const context={
    console,Date,Math,JSON,String,Number,Boolean,Array,Object,Set,Map,Error,Promise,
    AI:{model:'muse-glimmer:30b'},CREW_ALL:roles,productionState:()=>production,
    crewRequireGreenroom:async()=>true,crewOpenRecord:async()=>production.greenroomThreadId,
    productionCheckpoint:()=>true,crewFind:id=>roles.find(role=>role.id===id||role.at===id),
    crewGreenroomRoleId:role=>role.greenroomRoleId||role.id,
    crewInvoke:async(command,args)=>{
      if(command==='greenroom_send_conversation'){
        sent=args.request;
        return {hostId:'host',message:{id:'message',created_at:'2026-08-16T06:00:00Z'},delivery:{id:'delivery',status:'claimed'}};
      }
      return {};
    }
  };
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(`${between('const CREW_COLLABORATION_SCHEMA', 'function crewGreenroomWorkPacket')}
    globalThis.sendHandoff=crewEnsureAssignmentHandoff;`,context);
  await context.sendHandoff(roles[2],{id:'work-1'},'Continue the approved photo wall.');
  assert.equal(sent.toRoleId,'prompt_writer');
  assert.match(sent.summary,/@prompt-writer/);
  assert.doesNotMatch(sent.summary,/@stills-prompt/);
  assert.doesNotMatch(sent.details,/@stills-prompt/);
});

test('conversation messages retain exact typed routing in Studio Town', async () => {
  const modelSource=await readFile(new URL('../src/modules/studio-town/town-model.js',import.meta.url),'utf8');
  const context={console,Date,Math,JSON,String,Number,Boolean,Array,Object,Set,Map};
  context.globalThis=context;vm.createContext(context);vm.runInContext(modelSource,context);
  const events=context.StudioTownModel.deriveEvents({projectId:'p',production:{id:'run'},transcript:[{
    id:'request-1',kind:'conversation',eventType:'request',intent:'question',fromRoleId:'director',toRoleIds:['story_editor'],
    roleId:'director',status:'acknowledged',at:'2026-08-16T06:00:00Z',acknowledgedAt:'2026-08-16T06:00:01Z',text:'Which visible action proves the premise?'
  }]});
  assert.equal(events.length,1);
  assert.equal(events[0].type,'request');
  assert.equal(events[0].fromRoleId,'director');
  assert.deepEqual([...events[0].toRoleIds],['story_editor']);
  assert.equal(events[0].acknowledgedAt,'2026-08-16T06:00:01Z');
});
