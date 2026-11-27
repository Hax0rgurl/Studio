import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const producer = fs.readFileSync(new URL('../src/studio-producer.js', import.meta.url),'utf8');

function floor(){
  const settings=new Map(), starts=[];
  const ctx={crypto,console,window:{__TAURI__:{core:{invoke(){}}}},
    localStorage:{getItem:key=>settings.get(key)??null,setItem:(key,value)=>settings.set(key,value)},
    CREW:{},canonicalWorkerLocked:()=>false,productionState:()=>null,DB:{projects:[]},crewInvoke:async()=>true,
    activeDraft:()=>null,crewStart:async(...args)=>starts.push(args),toast(){},studioPlugins:()=>[]};
  vm.createContext(ctx);
  vm.runInContext(producer,ctx);
  ctx.aiParseJson=JSON.parse;
  ctx.floorChat=async (model,role)=>JSON.stringify(role.startsWith('Director')?{pitches:['A','B','C'].map(title=>({title,opening:'Setup',ending:'Payoff',whyWatch:'A reversal'}))}:{index:1,reason:'The second ending resolves the opening question.'});
  return {ctx,starts,run:source=>vm.runInContext(source,ctx)};
}

test('opening a quiet studio assigns film one to the normal producer',async()=>{
  const {run,starts}=floor();
  await run('wakeProducer()');
  assert.equal(starts.length,1);
  assert.equal(starts[0][0],'idea');
  assert.equal(starts[0][2].booking.number,1);
  assert.equal(starts[0][2].targetMinutes*60,10);
});

test('new directions are durable and take priority on a fresh launch',async()=>{
  const {ctx,run,starts}=floor();
  ctx.localStorage.setItem('studio.producer.inbox.v1',JSON.stringify([{id:'job',direction:'A silent comedy about a hat.'}]));
  await run('wakeProducer()');
  assert.match(starts[0][1],/silent comedy/);
  assert.equal(run('readBooking().count'),1);
  assert.equal(ctx.localStorage.getItem('studio.producer.inbox.v1'),'[]');
});

test('reopening a completed double bill on the same day submits no duplicate',async()=>{
  const {run,starts}=floor();
  run("const book=bookFilms();book.phase='complete';book.finishedDay=productionDay();saveBooking(book)");
  await run('wakeProducer()');
  assert.deepEqual(starts,[]);
});

test('film two receives the saved screening and the first screenplay',async()=>{
  const {run,starts}=floor();
  run(`const book=bookFilms();
    book.number=2;
    book.films=[{title:'The Empty Chair',scenes:[{slug:'INT. KITCHEN'}],
      review:{observation:'At 6s the chair is obscured.',lesson:'Hold the empty chair in silhouette.'}}];
    saveBooking(book);`);
  await run('wakeProducer()');
  assert.equal(starts[0][2].booking.number,2);
  assert.match(starts[0][1],/INT\. KITCHEN/);
  assert.match(starts[0][1],/Hold the empty chair in silhouette/);
});

test('a supplied screenplay enters script mode with its words intact',async()=>{
  const {ctx,run,starts}=floor();
  const page='The red umbrella drips on the tile.';
  const scenes=[{slug:'INT. FOYER',text:page}];
  Object.assign(ctx,{S:{},crewCreateIdeaProject:()=>true,runAutoBreakdown(){},cardsFromScenes(){},persistNow:()=>true});
  ctx.localStorage.setItem('studio.producer.inbox.v1',JSON.stringify([
    {id:'script',direction:'Keep the long silences.',script:{title:'Umbrella',filename:'Umbrella.fountain',scenes}}
  ]));
  await run('wakeProducer()');
  assert.equal(starts[0][0],'script');
  assert.equal(ctx.S.scenes[0].text,page);
  assert.equal(ctx.S.scriptName,'Umbrella.fountain');
  assert.match(starts[0][1],/Keep the long silences/);
});

test('the producer respects a stopped production',async()=>{
  const {ctx,run,starts}=floor();
  const book=run('bookFilms()');
  ctx.productionState=()=>({booking:{id:book.id,number:1},status:'cancelled'});
  await run('wakeProducer()');
  await run('wakeProducer()');
  assert.equal(run('readBooking().phase'),'held');
  assert.equal(starts.length,0);
});

test('a producer rejection keeps the floor in development without authorizing media',async()=>{
  const {ctx,run,starts}=floor();
  ctx.floorChat=async(model,role)=>JSON.stringify(role.startsWith('Director')
    ? {pitches:['A','B','C'].map(title=>({title,opening:'Opening',ending:'Ending',whyWatch:'Reason'}))}
    : {index:-1,reason:'Every ending repeats what the opening already tells us.'});
  await run('wakeProducer()');
  assert.equal(starts.length,0);
  assert.match(run('readBooking().commission1.rejection'),/Every ending/);
});

test('queued screenplay uses its saved draft, including a deferred breakdown',async()=>{
  const {ctx,run,starts}=floor();
  const draft={id:'revision',needsBreakdown:true,state:{look:{lighting:'One bare bulb'}}};
  ctx.DB.projects=[{id:'film',drafts:[draft]}];
  const order=[];
  Object.assign(ctx,{
    ACTIVE:{},
    openDraft(projectId,draftId){ctx.ACTIVE={p:projectId,d:draftId};order.push('open');},
    runAutoBreakdown(){order.push('breakdown');},cardsFromScenes(){order.push('cards');},
    persistNow(){order.push('save');return true;}
  });
  ctx.localStorage.setItem('studio.producer.inbox.v1',JSON.stringify([
    {id:'revised-film',direction:'Keep the pauses.',script:{projectId:'film',draftId:'revision'}}
  ]));
  await run('wakeProducer()');
  assert.deepEqual(order,['open','breakdown','cards','save']);
  assert.equal(draft.needsBreakdown,undefined);
  assert.equal(starts[0][0],'script');
  assert.equal(draft.state.look.lighting,'One bare bulb');
  assert.equal(starts[0][2].targetMinutes,undefined);
});

test('new bookings commission and write against actual screened cuts, including legacy reviews',async()=>{
  const {ctx,run,starts}=floor();
  function draft(id,title,status,cut,review){
    return {id,state:{title,production:{id,status,completedAt:'2026-11-01',screening:review},cut:{productionRunId:cut}}};
  }
  const good=draft('a','Lost Ticket','complete','a',{observation:'At 4s the fare is obscured.',lesson:'Hold the fare in silhouette.'});
  ctx.DB.projects=[{id:'library',drafts:[good,{...good,id:'copy'},draft('b','Unfinished','paused','b',good.state.production.screening),draft('c','Orphan','complete','other',good.state.production.screening)]}];
  const prompts=[],chat=ctx.floorChat;
  ctx.floorChat=(model,role,prompt)=>{prompts.push(prompt);return chat(model,role,prompt);};
  await run("submitProduction('A comic duel at dawn.');");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts.length,1);
  for(const text of [...prompts,starts[0][1]]){
    assert.match(text,/Hold the fare in silhouette/);
    assert.match(text,/comic duel/);
    assert.doesNotMatch(text,/Unfinished|Orphan/);
  }
  assert.deepEqual(Array.from(starts[0][2].booking.screeningSources,row=>row.runId),['a']);
});

test('screening already saved to the finished cut survives restart without charging for a second review',async()=>{
  const {ctx,run}=floor(),book=run('bookFilms()');
  const p={id:'runA',booking:{id:book.id,number:1},status:'complete',screening:{observation:'At 6s the gate is shut.',lesson:'Show the latch before the turn.'}};
  Object.assign(ctx,{ACTIVE:{p:'project',d:'draft'},S:{title:'Latch',cut:{productionRunId:'runA',outputPath:'cut.mp4'},scenes:[]},productionState:()=>p,
    floorCall:()=>assert.fail('screening already saved'),crewSendConversation:async()=>({}),crewFinishConversation:async()=>{}});
  await run('wakeProducer()');
  assert.equal(run('readBooking().films[0].review.lesson'),p.screening.lesson);
  assert.equal(run('readBooking().number'),2);
});

test('switching drafts while the editor reads a cut cannot attach its review to another film',async()=>{
  const {ctx,run}=floor(),book=run('bookFilms()');
  const p={id:'first',booking:{id:book.id,number:1},status:'complete'};
  Object.assign(ctx,{ACTIVE:{p:'a',d:'draft'},S:{title:'First',cut:{productionRunId:'first'},scenes:[]},productionState:()=>p,
    floorCall:async()=>({images:['a','b','c','d'],seconds:[1,4,6,9]}),
    floorChat:async()=>{ctx.ACTIVE.d='other';return JSON.stringify({observation:'At 4s the sign is hidden.',lesson:'Hold on the sign.'});},
    productionCheckpoint:()=>assert.fail('wrong draft')});
  await run('wakeProducer()');
  assert.equal(p.screening,undefined);
  assert.equal(run('readBooking().films.length'),0);
  assert.equal(run('readBooking().phase'),'ready');
});
