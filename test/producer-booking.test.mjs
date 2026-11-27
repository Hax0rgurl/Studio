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
