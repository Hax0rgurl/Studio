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
  ctx.screeningSheet=async sample=>sample.images.join(',');
  ctx.floorChat=async (model,role)=>JSON.stringify(role.startsWith('Director')?{pitches:['A','B','C'].map(title=>({title,opening:'Setup',ending:'Payoff',whyWatch:'A reversal'}))}:{index:1,reason:'The second ending resolves the opening question.',setupQuote:'Setup',payoffQuote:'Payoff',storyJudgment:'earned',humanReason:'The reversal changes who has the power in the scene.',blockingGap:''});
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

test('shelving an unshot original preserves the draft and requests different pitches for the same booking',async()=>{
  const {ctx,starts,run}=floor(),book=run('bookFilms()');
  const old={title:'Previous premise',opening:'Keys drop.',ending:'Door opens.',whyWatch:'The original pitch.'};
  const film={id:'old',mode:'idea',status:'cancelled',steps:{writer:{status:'done'}},booking:{id:book.id,number:1,commission:{choice:old}}};
  ctx.productionState=()=>film;ctx.productionCheckpoint=()=>true;
  book.phase='held';book.error='cancelled';ctx.bookingForTest=book;run('saveBooking(bookingForTest)');
  ctx.CREW.calling=true;
  run('requestFreshPremises()');
  assert.ok(film.shelveRequestedAt);assert.equal(ctx.CREW.cancel,true);
  ctx.CREW.calling=false;
  await run('wakeProducer()');
  assert.equal(film.status,'superseded');assert.equal(film.supersededBooking.commission.choice,old);
  assert.equal(run('readBooking().phase'),'ready');assert.equal(starts.length,0);
  const calls=[],chat=ctx.floorChat;
  ctx.floorChat=(model,role,prompt,...args)=>{calls.push(prompt);return chat(model,role,prompt,...args);};
  await run('wakeProducer()');
  assert.equal(starts.length,1);assert.equal(starts[0][2].booking.id,book.id);
  assert.ok(calls.every(prompt=>prompt.includes(old.opening)&&prompt.includes('different stories')));
  assert.notEqual(starts[0][2].booking.commission.choice.title,old.title);
});

test('the producer can recommission an undirected original only after two enacted rehearsals fail review',async()=>{
  for(const choice of ['restage','repitch']){
    const {ctx,run,starts}=floor(),book=run('bookFilms()');
    const review=revisionPass=>({revisionPass,verdict:'revise',problems:[{sceneNumber:1,severity:'major',issue:'The hand opens after the door is gone.'}]});
    const w={stagingNotes:[{sceneNumber:1,at:'first'},{sceneNumber:1,at:'second'}],reviews:[review(1),review(2)],revisionHistory:[]};
    w.review=w.reviews[1];
    const p={id:'held-story',status:'running',mode:'idea',steps:{writer:{status:'done'},dp:{status:'waiting'}},
      booking:{id:book.id,number:book.number,fromSource:false,commission:{choice:{title:'Original',opening:'A hand.',ending:'A door.'}}},writerWork:w};
    let calls=0;
    Object.assign(ctx,{p,productionState:()=>p,crewScreenplayDirection:()=>[],crewFind:id=>({id}),crewContext:()=>'',crewScreenplayPages:()=>[],
      productionCheckpoint:()=>true,crewJsonAgentCall:async(role,prompt,opt,validate)=>{
        assert.equal(role.id,'producer');calls++;
        assert.throws(()=>validate({choice,finding:'invented evidence',reason:'reason',nextAction:'stage it'}));
        return validate({choice,finding:'door is gone',reason:'The reveal cannot be seen.',nextAction:'Start from the audible latch.'});
      }});
    w.revisionHistory.push({sceneNumber:1,review:review(0),stagingAt:'first'});await run('crewDevelopmentMeeting(p)');assert.equal(calls,0);
    w.revisionHistory.push({sceneNumber:1,review:review(1),stagingAt:'second'});
    await run('crewDevelopmentMeeting(p)');await run('crewDevelopmentMeeting(p)');
    assert.equal(calls,1);assert.equal(w.producerMeetings.length,1);assert.equal(w.review.verdict,'revise');
    if(choice==='restage'){assert.ok(!p.shelveRequestedAt);continue;}
    assert.equal(p.shelveRequestedBy,'producer');p.status='paused';await run('wakeProducer()');
    assert.equal(p.status,'superseded');assert.match(p.supersededReason,/producer/);
    const kept=run('readBooking().shelvedOriginals')[p.id];assert.equal(kept.by,'producer');assert.equal(kept.reason,w.producerMeetings[0].reason);
    assert.equal(starts.length,0);await run('wakeProducer()');assert.equal(starts.length,1);
    assert.equal(starts[0][2].booking.id,book.id);assert.equal(starts[0][2].booking.number,1);
  }
});

test('the producer preserves supplied material, new direction, stopped films and photography',()=>{
  const {ctx,run}=floor(),book=run('bookFilms()');
  const p={mode:'idea',status:'running',booking:{id:book.id,number:1,fromSource:false,commission:{choice:{title:'Original'}}}};
  ctx.book=book;ctx.p=p;
  const eligible=()=>run('producerOwnsPremise(p,book)');
  assert.equal(eligible(),true);
  for(const [obj,key,value] of [[p,'status','cancelled'],[book,'direction','Keep this opening'],[book,'script',{}],[book,'shelfChoice1',{text:'A play'}],
    [book,'pitchNotes',[{number:1,text:'Keep the prop'}]],[p,'clientNotes',[{text:'Keep this story'}]],[p.booking,'fromSource',true],[p,'jobs',{shot:{}}],[p,'steps',{dp:{status:'done'}}]]){
    const before=obj[key];obj[key]=value;assert.equal(eligible(),false,key);obj[key]=before;
  }
  ctx.S={scenes:[{shots:[{board:{frame:'photo'}}]}]};assert.equal(eligible(),false);
});

test('an older busy-worker hold wakes after the worker exits and preserves the original brief',async()=>{
  const {ctx,run}=floor();
  const book=run('bookFilms()'), error='Another project worker is running.';
  const film={id:'current',booking:{id:book.id,number:1},status:'needs_attention',brief:'Keep the silence.',error};
  ctx.productionState=()=>film;
  let locked=true,resumes=0;
  ctx.canonicalWorkerLocked=()=>locked;
  ctx.crewResume=async()=>{resumes++;};
  book.phase='held';book.error=error;ctx.book=book;run('saveBooking(book)');
  await run('wakeProducer()');assert.equal(resumes,0);
  locked=false; film.status='cancelled';
  await run('wakeProducer()');assert.equal(resumes,0);
  film.status='needs_attention';film.jobs={shot:{status:'unknown'}};
  await run('wakeProducer()');assert.equal(resumes,0);
  film.jobs={};
  await run('wakeProducer()');assert.equal(resumes,1);
  assert.equal(run('readBooking().phase'),'ready');
  assert.equal(film.brief,'Keep the silence.');
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

test('a filmmaker screening goes from the finished cut to both commissioning roles',async()=>{
  const {ctx,run,starts}=floor();
  const note='Hold on the receipt until the last word can be read.';
  const production={id:'run',status:'complete',clientNotes:[
    {kind:'screening',text:note,targetRoleId:'editor'},
    {kind:'direction',text:'Only for the old shoot.'}
  ]};
  ctx.DB.projects=[{id:'film',drafts:[{id:'screened',state:{title:'Till',production,cut:{productionRunId:'run'}}},
    {id:'wrong-cut',state:{title:'Other cut',production,cut:{productionRunId:'different'}}}]}];
  const prompts=[],chat=ctx.floorChat;
  ctx.floorChat=(model,role,prompt)=>{prompts.push(prompt);return chat(model,role,prompt);};
  await run('wakeProducer()');
  assert.equal(prompts.length,2);
  for(const text of [...prompts,starts[0][1]]){
    assert.ok(text.includes(note));
    assert.match(text,/"targetRoleId":"editor"/);
    assert.doesNotMatch(text,/Only for the old shoot|Other cut/);
  }
});

test('the written beats must support the commissioning decision and any blocking gap sends the slate back',async()=>{
  for(const [setupQuote,blockingGap,expected] of [
    ['a missing ladder','','actual pitch'],
    ['She climbs','The suitcase arrives without any setup.','suitcase']
  ]){
    const {ctx,run,starts}=floor();
    ctx.floorChat=async(_,role,prompt)=>{
      if(role.startsWith('Director'))return JSON.stringify({pitches:['One','Two','Three'].map(title=>({
        title,opening:'She climbs onto the luggage scale.',ending:'A suitcase falls from the ceiling.',whyWatch:'Guaranteed viral sensation!'
      }))});
      assert.doesNotMatch(prompt,/Guaranteed viral sensation!/);
      return JSON.stringify({index:0,reason:'She is crushed under her own belongings.',setupQuote,payoffQuote:'falls from the ceiling',blockingGap});
    };
    await run('wakeProducer()');
    assert.equal(starts.length,0);
    assert.ok(run('readBooking().commission1.rejection').includes(expected));
  }
});

test('daily screenings compare the cut with a source from its own brief and record missing evidence',async()=>{
  for (const missing of [false,true]){
    const {ctx,run}=floor(),book=run('bookFilms()');
    book.count=1;ctx.saveBooking(book);
    const prior={title:'Before',runId:'prior',review:{currentSecond:4,observation:'The face was obscured.',lesson:'Hold the reveal.'},filmmakerNotes:[{text:'Keep the face in focus.'}]};
    const p={id:'today',brief:'Apply the focus note.',status:'complete',booking:{id:book.id,number:1,screeningSources:[prior]}};
    const ids=[];
    Object.assign(ctx,{ACTIVE:{p:'project',d:'draft'},S:{title:'Today',cut:{productionRunId:p.id},scenes:[]},productionState:()=>p,
      floorCall:async(action,{runId})=>{
        ids.push(runId);
        if(missing&&runId==='prior')throw Error('Film unavailable.');
        return {seconds:[1,4,6,9],images:[1,2,3,4].map(n=>runId+n)};
      },
      floorChat:async(model,role,prompt,images)=>{
        assert.equal(images.length,1);
        if(!missing){
          assert.equal(images[0],'today1,today2,today3,today4');
          assert.match(prompt,/The face was obscured/);
          assert.match(prompt,/Keep the face in focus/);
        }
        return JSON.stringify({currentSecond:9,earlierSecond:4,observation:'At 9s the face is sharp.',nextAction:'Test focus through the turn.',successCheck:'The eye stays legible.',verdict:'partial',evidence:'Both cuts show the face.'});
      },
      productionCheckpoint:()=>true,crewSendConversation:async()=>({}),crewFinishConversation:async()=>{}});
    await run('wakeProducer()');
    assert.deepEqual(ids,['today','prior']);
    assert.equal(p.screening.comparedWith.runId,'prior');
    assert.match(p.screening.lesson,/Test focus through the turn.*eye stays legible/);
    assert.equal(p.screening.verdict,missing?'unproven':'partial');
    if(missing)assert.match(p.screening.evidence,/unavailable/);
    assert.equal(run('readBooking().phase'),'complete');
  }
});

test('publishing taste excludes listed subjects before the vote and requires evidence for a greenlight',async()=>{
  const {ctx,run}=floor(), seen=[];
  ctx.localStorage.setItem('studio.taste.publishing.v1',JSON.stringify({brief:'I post observational comedy about work.',excluded:['wedding']}));
  const pitches=['Wedding march','Night shift','Welder'].map(title=>({title,opening:'Everyone clocks in.',ending:'One card stays behind.',whyWatch:'The last card is the boss.'}));
  let cited='not the filmmaker',directorCalls=0;
  ctx.floorChat=async(_,role,prompt)=>{
    if(role.startsWith('Director')){directorCalls++;return JSON.stringify({pitches});}
    seen.push(JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1)));
    return JSON.stringify({index:1,reason:'Labor is invisible.',setupQuote:'clocks in',payoffQuote:'stays behind',storyJudgment:'earned',humanReason:'The reversal changes who has the power in the scene.',blockingGap:'',postingEvidence:cited,postingReason:'The abandoned timecard makes overtime visible.'});
  };
  const book=run('bookFilms()');
  assert.equal((await ctx.commissionOriginal(book,'')).choice,null);
  cited='observational comedy about work';
  assert.equal((await ctx.commissionOriginal(run('readBooking()'),'')).choice.title,'Night shift');
  assert.equal(directorCalls,1,'A corrected producer citation must reuse the saved pitches, including after reload');
  assert.deepEqual(seen[0].map(x=>x.index),[1,2]);
  ctx.localStorage.setItem('studio.taste.publishing.v1',JSON.stringify({brief:'Changed.',excluded:['wedding','night shift','welder']}));
  assert.equal((await ctx.commissionOriginal(book,'')).choice,null);
  assert.equal(seen.length,2);
  assert.equal(directorCalls,2,'A new publishing brief requires fresh pitches');
});

test('local commissioning requests a structured slate and a ballot tied to personal taste',async()=>{
  const {ctx,run}=floor(),calls=[];
  ctx.localStorage.setItem('studio.taste.publishing.v1',JSON.stringify({brief:'One sound that catches my ear.'}));
  ctx.aiVisionChat=async(role,prompt,images,model,temperature,schema)=>{
    calls.push({role,prompt,schema});
    if(calls.length===1)return JSON.stringify({pitches:['One','Two','Three'].map(title=>({
      title,opening:'The machine whistles.',ending:'A bird answers.',whyWatch:'The outside answers the factory.'}))});
    return JSON.stringify({index:0,reason:'The whistle gets an unexpected answer.',setupQuote:'machine whistles',
      payoffQuote:'bird answers',storyJudgment:'earned',humanReason:'The reversal changes who has the power in the scene.',blockingGap:'',postingEvidence:'One sound that catches my ear.',postingReason:'The two calls make the exchange legible.'});
  };
  const book=run('bookFilms()');book.textModel='qwen3.5:latest';
  const decision=await ctx.commissionOriginal(book,'');
  assert.equal(decision.choice.title,'One');
  assert.equal(calls[0].schema.properties.pitches.minItems,3);
  assert.equal(calls[0].schema.properties.pitches.maxItems,3);
  assert.deepEqual(Array.from(calls[0].schema.properties.pitches.items.required),['title','opening','ending','whyWatch']);
  assert.ok(calls[1].schema.required.includes('postingEvidence'));
  assert.match(calls[1].prompt,/One sound that catches my ear/);
});

test('the producer can select a stored publishing passage and keeps the actual earlier vote',async()=>{
  const {ctx,run}=floor(),book=run('bookFilms()');
  ctx.localStorage.setItem('studio.taste.publishing.v1',JSON.stringify({brief:'The sound reveals who is outside.'}));
  let passage='T99',directorCalls=0;
  ctx.floorChat=async(_,role,prompt)=>{
    if(role.startsWith('Director')){
      directorCalls++;
      return JSON.stringify({pitches:['Bell','Lever','Scale'].map(title=>({title,opening:'A bell rings.',ending:'The bird answers.',whyWatch:'A counterfeit alarm.'}))});
    }
    assert.match(prompt,/"T1":"The sound reveals who is outside\."/);
    return JSON.stringify({index:0,setupQuote:'bell rings',payoffQuote:'bird answers',storyJudgment:'earned',humanReason:'The reversal changes who has the power in the scene.',blockingGap:'',reason:'The answer identifies the intruder.',
      postingEvidence:passage,postingReason:'The answer from the bird gives the sound a source.'});
  };
  let meeting=await ctx.commissionOriginal(book,'');
  assert.equal(meeting.choice,null);
  passage='T1';
  meeting=await ctx.commissionOriginal(run('readBooking()'),'');
  assert.equal(directorCalls,1);assert.equal(meeting.rounds.length,1);
  assert.deepEqual(Array.from(meeting.rounds[0].decisions,d=>d.stage),['voting','approved']);
  assert.equal(meeting.postingEvidence,'The sound reveals who is outside.');
});

test('direction arriving during a vote survives the pending response and reaches the next pitches',async()=>{
  const {ctx,run}=floor(),book=run('bookFilms()');
  const chat=ctx.floorChat;let sent=false;
  ctx.floorChat=async(model,role,prompt,...rest)=>{
    if(!role.startsWith('Director')&&!sent){
      sent=true;assert.ok(ctx.sendMeetingDirection('Let the audience hear the answer before they see it.','director',book.id,1));
    }else if(role.startsWith('Director')&&sent)assert.match(prompt,/audience hear the answer/);
    return chat(model,role,prompt,...rest);
  };
  const obsolete=await ctx.commissionOriginal(book,'');
  assert.equal(obsolete.choice,null);
  assert.equal(run('readBooking().pitchNotes.length'),1);
  const updated=await ctx.commissionOriginal(run('readBooking()'),'');
  assert.ok(updated.choice);
  assert.equal(updated.rounds.length,2);
  assert.equal(updated.rounds[0].decisions.length,0);
});

test('the director revises the rejected story with the producer’s note and hands accepted pages to the writer',async()=>{
  const {ctx,run,starts}=floor();
  let drafts=0;
  ctx.floorChat=async(_,role,prompt)=>{
    if(role.startsWith('Director')){
      if(++drafts===2){
        assert.match(prompt,/The last bulb goes out/);
        assert.match(prompt,/Establish who controls the light/);
      }
      const opening=drafts===1?'A bell sounds.':'A clerk holds the light switch.';
      return JSON.stringify({pitches:['The bill','After hours','Relay'].map(title=>({
        title,opening,ending:'The last bulb goes out.',whyWatch:'The clerk decides who gets to stay.'}))});
    }
    return JSON.stringify(drafts===1?{index:-1,reason:'Establish who controls the light.'}:
      {index:0,reason:'Closing the shop becomes a deliberate choice.',setupQuote:'holds the light switch',
        payoffQuote:'last bulb goes out',storyJudgment:'earned',humanReason:'The reversal changes who has the power in the scene.',blockingGap:''});
  };
  await run('wakeProducer()');
  assert.equal(starts.length,0);
  assert.equal(run('readBooking().commission1.stage'),'rewrite');
  await run('wakeProducer()');
  assert.equal(starts.length,1);
  assert.match(starts[0][1],/A clerk holds the light switch/);
  assert.equal(starts[0][2].booking.commission.stage,'approved');
});

test('a timed-out pitch vote resumes on its saved pages after backoff without touching a photography hold',async()=>{
  const {ctx,run,starts}=floor(),model=ctx.floorChat;
  let pitches=0,votes=0;
  ctx.floorChat=async(...args)=>{
    if(args[1].startsWith('Director'))pitches++;
    else if(++votes===1)throw Error('Operation timed out');
    return model(...args);
  };
  await run('wakeProducer()');
  assert.equal(run('readBooking().phase'),'held');
  await run('wakeProducer()');
  assert.equal(votes,1);
  assert.ok(run('readBooking().pitchRetryAt')>Date.now());
  run('const pending=readBooking();pending.pitchRetryAt=Date.now()-1;saveBooking(pending)');
  await run('wakeProducer()');
  assert.equal(starts.length,1);
  assert.equal(pitches,1);
  assert.equal(votes,2);
  assert.equal(run('readBooking().pitchRetryAt'),undefined);
  run("const photo=readBooking();photo.phase='held';photo.error='Storyboard rendering failed: Submission interrupted before provider receipt.';saveBooking(photo)");
  await run('wakeProducer()');
  assert.equal(run('readBooking().phase'),'held');
  assert.equal(votes,2);
});

test('a causal visual effect with valid citations still goes back to the director if the producer finds no story',async()=>{
  const {ctx,run,starts}=floor(),chat=ctx.floorChat;
  ctx.floorChat=async(model,role,...args)=>{
    const reply=JSON.parse(await chat(model,role,...args));
    if(role.startsWith('Director'))return JSON.stringify(reply);
    return JSON.stringify({...reply,storyJudgment:'incident_only',humanReason:'The vibration explains the collision, but nothing in that outcome matters to anyone.'});
  };
  await run('wakeProducer()');
  const meeting=run('readBooking().commission1');
  assert.equal(starts.length,0);assert.equal(meeting.choice,null);assert.equal(meeting.stage,'rewrite');
  assert.match(meeting.rejection,/nothing in that outcome matters/);
});

test('a filmmaker replacement stops an unshot draft and goes straight to the crew on the next wake',async()=>{
  const {ctx,run,starts}=floor(),book=run('bookFilms()');
  const text='Midnight Crossing\nThe lamps go out.';
  const old={id:'old',booking:{id:book.id,number:1},status:'needs_attention',currentStep:'story_review',
    clientNotes:[{kind:'replacement',text},{kind:'direction',text:'This is SHIT!'}]};
  Object.assign(ctx,{productionState:()=>old,productionCheckpoint:()=>true,crewUnprovenJobs:()=>[]});
  await run('wakeProducer()');
  assert.equal(old.status,'superseded');
  await run('wakeProducer()');
  assert.equal(starts.length,1);assert.equal(starts[0][2].booking.replacement,text);
  assert.equal(starts[0][2].booking.commission,null);
  assert.match(starts[0][1],/Midnight Crossing/);
});

test('producer interprets a plain-language rejection before another department works',async()=>{
  const {ctx,run,starts}=floor(),b=run('bookFilms()');
  const note={id:'note',text:'I just saw enough. Put this one in the bin.',awaitingProducer:true};
  const film={id:'original',booking:{id:b.id,number:1,commission:{choice:{title:'Old'}}},status:'paused',clientNotes:[note]};
  ctx.S={title:'Old'};ctx.productionState=()=>film;ctx.productionCheckpoint=()=>true;ctx.crewUnprovenJobs=()=>[];
  ctx.floorChat=async()=>JSON.stringify({action:'reject',reply:'I will shelve this and ask for new pitches.'});
  await run('wakeProducer()');assert.equal(note.producerReading.action,'reject');
  assert.equal(starts.length,0);await run('wakeProducer()');assert.equal(film.status,'superseded');
});
