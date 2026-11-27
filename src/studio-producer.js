// The double bill is a booking for two ordinary Studio productions.
const billKey = 'studio.producer.double-bill.v1';
const floorOwner = crypto.randomUUID();
let bookingBusy = false;
let producerLeader = false;
let assigningFilm = null;
function productionDay(){return new Date().toLocaleDateString('en-CA');}
function readBooking(){return JSON.parse(localStorage.getItem(billKey)||'null');}
function saveBooking(book){localStorage.setItem(billKey,JSON.stringify(book));}
function floorProduction(){return typeof S!=='undefined' && (S.production?.booking || S.production?.studioCrew);}
function studioCrewSettings(){
  const selected=localStorage.getItem('studio.renderer');
  const renderer=selected?studioPlugins().find(entry=>entry.url===selected):null;
  if(selected&&(!renderer||!renderer.frameArg))throw Error('The selected renderer needs a storyboard frame input.');
  return {renderer:renderer||null,textModel:localStorage.getItem('studio.doubleFeatureModel')||'qwen3.8-max'};
}
function floorCall(action,data={}){
  return window.__TAURI__.core.invoke('studio_production',{action,data,owner:floorOwner});
}
function pluginProviderId(plugin){
  return 'studio-plugin-'+videoPromptFingerprint(plugin.url).slice(6);
}
function floorProviders(renderer=null){
  const plugins=studioPlugins();
  if(renderer&&!plugins.some(entry=>entry.url===renderer.url))plugins.push(renderer);
  const video=(id,name,model,plugin)=>({id,name,plugin,mediaKinds:['video'],models:[{id:model}],capabilities:{imageToVideo:true,minSeconds:5,maxSeconds:5,defaultClipSeconds:5}});
  return [
    video('studio-wan','Wan 3','wan3.0-video',null),
    ...plugins.filter(p=>p.frameArg).map(p=>video(pluginProviderId(p),p.name,p.tool,p)),
    {id:'studio-qwen-image',name:'Qwen Image',mediaKinds:['image'],models:[{id:'qwen-image-3.0-pro'}],capabilities:{textToImage:true}}
  ].map(p=>({...p,configured:true,requiresBillingApproval:true}));
}
function floorChat(model,system,prompt,images=[],json=true,opts={}){
  const content=images.length?[{type:'text',text:prompt},...images.map(data=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+data}}))]:prompt;
  return floorCall('chat',{model,json,temperature:opts.temperature??0.45,max_tokens:opts.maxTokens||8192,
    messages:[{role:'system',content:system+(opts.schema?'\nJSON schema: '+JSON.stringify(opts.schema):'')},{role:'user',content}]});
}
const inboxKey='studio.producer.inbox.v1';
function submitProduction(direction,script=null,options={}){
  const queue=JSON.parse(localStorage.getItem(inboxKey)||'[]');
  queue.push({id:crypto.randomUUID(),direction,script,options});
  localStorage.setItem(inboxKey,JSON.stringify(queue));
  toast('The producer received '+(script?.title||'your direction')+'.',true);
  wakeProducer();
}
function bookFilms(direction='',script=null,requestId='',options={}){
  const old=readBooking();
  if(old && old.phase!=='complete')throw Error('The current double feature already has the floor.');
  const {renderer,textModel}=studioCrewSettings();
  const book={options,requestId,count:requestId?1:2,renderer,id:crypto.randomUUID(),phase:'ready',films:[],direction,script,textModel,number:1};
  saveBooking(book);return book;
}
function bookingNeedsPhotoDecision(book){
  return book?.phase==='held'&&/Storyboard rendering failed: Submission interrupted before provider receipt/.test(book.error||'');
}
function pitchDirectionChanged(active,foundation){
  return active?.booking && active.mode==='idea' &&
       ((foundation && foundation!==(active.booking.foundationAtPitch||'')) || (!active.booking.commission && !active.booking.fromSource)) &&
       !['complete','cancelled'].includes(active.status) && !Object.keys(active.jobs||{}).length &&
       !active.images?.done && !allShots().some(({sh})=>boardOf(sh).frame);
}
function studioScreenings(){
  const seen=new Set(), rows=[];
  for(const project of DB.projects){
    for(const draft of project.drafts){
      const state=draft.state, p=state?.production;
      if(!p?.id || p.status!=='complete' || state.cut?.productionRunId!==p.id)continue;
      const filmmakerNotes=(p.clientNotes||[]).filter(note=>note.kind==='screening' && typeof note.text==='string')
        .map(({text,targetRoleId,at})=>({text,targetRoleId,at}));
      if(!p.screening?.observation&&!filmmakerNotes.length)continue;
      rows.push({filmmakerNotes,runId:p.id,projectId:project.id,draftId:draft.id,title:state.title,at:p.completedAt||state.cut.createdAt||'',review:p.screening||{}});
    }
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at)).filter(row=>{
    if(seen.has(row.runId))return false;
    seen.add(row.runId);return true;
  });
}
function screeningBrief(rows, pitching=false){
  if(!rows?.length)return '';
  return '\nEarlier screenings from this studio. Treat these as craft experiments. The filmmaker’s own notes take precedence over the editor’s interpretation of that film. Treat them as feedback on that specific work. The current direction and supplied material take priority. Apply a relevant lesson to a specific beat, or explain why it does not fit. Preserve uncertainty about earlier results.\n'+
    JSON.stringify(rows.map(({title,review,filmmakerNotes})=>({title,filmmakerNotes,observation:pitching?undefined:review.observation,nextTest:review.lesson,verdict:review.verdict,evidence:pitching?undefined:review.evidence})));
}
async function screeningSheet(sample){
  const images=await Promise.all(sample.images.map(async data=>{
    const image=new Image();
    image.src='data:image/jpeg;base64,'+data;
    await image.decode();
    return image;
  }));
  const canvas=document.createElement('canvas'),width=480,height=270,label=34;
  canvas.width=width*2;canvas.height=(height+label)*2;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.font='bold 21px sans-serif';ctx.fillStyle='#fff';
  images.forEach((image,j)=>{
    const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    const x=(j%2)*width,y=Math.floor(j/2)*(height+label);
    ctx.fillText(sample.seconds[j]+' s',x+10,y+24);
    ctx.drawImage(image,x+(width-w)/2,y+label+(height-h)/2,w,h);
  });
  return canvas.toDataURL('image/jpeg',0.90).split(',')[1];
}
const postingTasteKey='studio.taste.publishing.v1';
function postingTaste(){
  const value=JSON.parse(localStorage.getItem(postingTasteKey)||'{}');
  return {brief:String(value.brief||''),excluded:(Array.isArray(value.excluded)?value.excluded:[]).filter(x=>typeof x==='string'&&x.trim())};
}
function excludedPitchSubject(pitch,excluded){
  const words=s=>String(s).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
  const lines=[pitch.title,pitch.opening,pitch.ending,pitch.whyWatch||''].map(s=>' '+words(s).join(' ')+' ');
  return excluded.find(term=>{const phrase=words(term).join(' ');return phrase&&lines.some(line=>line.includes(' '+phrase+' '));})||'';
}
async function commissionOriginal(book,foundation){
  const key='commission'+book.number;
  const existing=book[key];
  const posting=postingTaste(),personal=!!(posting.brief||posting.excluded.length);
  const rules=typeof TASTE_OS==='undefined'?[]:(TASTE_OS.snapshot?.profile?.rules||[])
    .filter(r=>r.active!==false&&r.scope==='global'&&(!r.roles?.length||r.roles.some(id=>['director','producer','taste'].includes(id))))
    .map(r=>String(r.instruction||'').trim()).filter(Boolean);
  const postingSignature=JSON.stringify([posting,rules]);
  if(existing?.choice && existing.foundation===foundation && (existing.postingSignature===postingSignature||(!personal&&!rules.length&&!existing.postingSignature)))return existing;
  const textFields=names=>Object.fromEntries(names.map(name=>[name,{type:'string'}]));
  const pitchFields=textFields(['title','opening','ending','whyWatch']);
  const slateSchema={type:'object',additionalProperties:false,required:['pitches'],properties:{
    pitches:{type:'array',minItems:3,maxItems:3,items:{type:'object',additionalProperties:false,required:Object.keys(pitchFields),properties:pitchFields}}
  }};
  const consult=async(role,prompt,temperature,schema)=>{
    const raw=book.textModel==='qwen3.5:latest'?await aiVisionChat(role,prompt,[],book.textModel,temperature,schema):
      await floorChat(book.textModel,role,prompt,[],true,{temperature,schema});
    return aiParseJson(raw);
  };
  const fit=personal?'\nTasteOS publishing standard for new crew originals: '+posting.brief+
    '\nExcluded premise terms: '+JSON.stringify(posting.excluded)+'. Use the filmmaker’s stated taste and examples to decide whether they would actually post the finished film. Never claim that they posted or liked a work without evidence. Treat examples as evidence of what the filmmaker notices. Find the detail that makes this particular scene. Choose its look from the material.':'';
  const mandate='Filmmaker’s words, binding: '+foundation+'\nFilm-specific direction: '+(book.direction||'Crew original.')+fit+(rules.length?'\nGlobal TasteOS instructions: '+JSON.stringify(rules):'')+
    '\nRunning time: '+(book.options?.targetMinutes?book.options.targetMinutes*60:10)+' seconds.';
  const lessons=screeningBrief(book['screenings'+book.number],true);
  const sameBrief=existing?.foundation===foundation&&existing.postingSignature===postingSignature;
  const previous=sameBrief&&existing.rejection?existing:null;
  let pitches=sameBrief&&existing.stage==='voting'?existing.pitches:null;
  if(!pitches){
    book[key]={foundation,postingSignature,stage:'pitching',pitches:previous?.pitches||[],rejection:previous?.rejection||''};
    saveBooking(book);
    const slate=await consult('Director in a film studio pitch meeting',mandate+lessons+
      '\nPitch three genuinely different stories to the producer before any camera decisions. Give each pitch a different reason to watch. Name the particular sight, sound, exchange or discovery that catches attention, then show how it lands. An archival observation, a musical change or a moment that makes us need the next scene can earn an ending. Let the genre and the filmmaker guide you. A demonstration of materials or a predictable chain reaction does not constitute a story unless the filmmaker explicitly requests it. Let the current brief supply the characters, objects and world. A previous film’s craft note can change how this story reads. Only reuse its story elements when they serve this brief. For a character-led film, ground the hook in a recognizable want, risk, choice or contradiction. For a sensory or observational film, establish what we notice and why its return or change matters. Stage the premise clearly in the available time. An unbelievable event can be the whole attraction. Track weight, contact, momentum and what the surroundings do in response wherever they matter to the shot. If a character reveals an object, account for its size and where it came from. An original can establish its own dream logic. Keep the viewer oriented through the change. Plant what the ending depends on. Describe actions a viewer can follow in the available seconds. No camera specs. Return JSON with pitches, each containing title, opening, ending, and whyWatch.'+
      (previous?'\nYour previous pitches: '+JSON.stringify(previous.pitches)+'\nProducer’s decision: '+previous.rejection+'\nIf one of those stories still has a worthwhile hook, revise its opening or ending to solve the specific note. Offer genuinely different alternatives. If the producer found the subject itself unsuitable, move on.':''),0.9,slateSchema);
    if(!Array.isArray(slate.pitches)||slate.pitches.length!==3||slate.pitches.some(p=>!['title','opening','ending','whyWatch'].every(k=>typeof p[k]==='string'&&p[k].trim())))
      throw Error('The director returned an incomplete pitch slate.');
    pitches=slate.pitches;
    book[key]={foundation,postingSignature,stage:'voting',pitches};
    saveBooking(book);
  }
  const pages=pitches.map(({title,opening,ending})=>({title,opening,ending}));
  const permitted=pages.map((p,index)=>({...p,index})).filter(p=>!excludedPitchSubject(pitches[p.index],posting.excluded));
  if(!permitted.length){
    const rejection='All three premises contain subjects excluded in TasteOS: '+posting.excluded.join(', ')+'. Pitch different subjects.';
    book[key]={foundation,postingSignature,stage:'rewrite',pitches,choice:null,reason:rejection,rejection};saveBooking(book);return book[key];
  }
  // Restrict citation fields to the pages and taste evidence actually on the ballot.
  const quoteOptions=lines=>{
    const sentences=lines.flatMap(line=>(line||'').match(/[^.!?\n]+[.!?]*/gu)||[]);
    const excerpts=sentences.map(text=>text.trim()).filter(text=>text.length>=3);
    return {type:'string',enum:['',...new Set(excerpts)]};
  };
  const ballotFields={
    index:{type:'integer',enum:[-1,...permitted.map(p=>p.index)]},
    reason:{type:'string'},blockingGap:{type:'string'},
    setupQuote:quoteOptions(permitted.map(p=>p.opening)),payoffQuote:quoteOptions(permitted.map(p=>p.ending))
  };
  if(personal){
    ballotFields.postingEvidence=quoteOptions([posting.brief,foundation,...rules]);
    ballotFields.postingReason={type:'string'};
  }
  const ballotSchema={type:'object',additionalProperties:false,required:Object.keys(ballotFields),properties:ballotFields};
  const ballot=await consult('Independent commissioning producer',mandate+lessons+(sameBrief&&existing.stage==='voting'&&existing.rejection?'\nCorrect the producer’s previous decision on these same pages: '+existing.rejection:'')+
    '\nRead what the viewer will see or hear. Identify the particular detail that makes the scene. What does the closing beat let them notice, feel or want to see next? Judge the premise on its own terms. An impossible event can be deliberate. Test whether positions, contact and consequences stay consistent with what the film establishes. If a reveal needs an impossible hiding place, an unmotivated transformation, or missing time, count it as a blockingGap unless that specific effect is intentional and established. Recognizing a familiar setting alone earns no greenlight. What makes the opening worth staying for? What in that opening earns the ending? Flag an unintroduced prop solving the story or conflicting instructions about the same action. Surreal and observational films can earn the ending through a legible visual or emotional connection. Check whether someone can read the change in the allotted time. An earlier film’s prop or technique is never evidence for a beat on these pages.'+
    '\nReturn JSON with index (0, 1, 2 or -1 to reject all) and reason. For a selection also include setupQuote copied exactly from opening, payoffQuote copied exactly from ending, and blockingGap (an empty string only if there is no missing connection). In reason explain how those specific beats connect and why watching the payoff matters. If none of the eligible pitches work, choose -1 and leave the selection evidence fields empty. Name the most promising beat and one concrete revision that could earn it a greenlight, or explain why the director needs a different premise. A deliberate impossibility established on screen is a premise. A blocking gap is a missing step that prevents the audience from following that premise. Only flag gaps that materially affect the viewing experience.\n'+ (personal?' Include postingEvidence, an exact quote from the publishing brief, foundation or active global TasteOS instructions, and postingReason explaining how an observable beat earns that connection. Use the original index printed on each eligible pitch.':'')+'\n'+JSON.stringify(permitted),0.35,ballotSchema);
  if(!Number.isInteger(ballot.index)||ballot.index< -1||ballot.index>2||!String(ballot.reason||'').trim())throw Error('The producer returned an incomplete commissioning decision.');
  const pick=pages[ballot.index];
  let rejection=pick?'':ballot.reason;
  let needsCorrectBallot=false;
  if(pick){
    const quoted=(line,quote)=>typeof quote==='string' && quote.trim().length>=3 && line.includes(quote.trim());
    if(typeof ballot.blockingGap!=='string' || !quoted(pick.opening,ballot.setupQuote) || !quoted(pick.ending,ballot.payoffQuote)){
      needsCorrectBallot=true;
      rejection='The producer must identify the setup and payoff in the actual pitch before commissioning it.';
    }
    if(typeof ballot.blockingGap==='string'&&ballot.blockingGap.trim()){
      needsCorrectBallot=false;
      rejection=ballot.blockingGap.trim();
    }
    if(!permitted.some(p=>p.index===ballot.index)){
      needsCorrectBallot=true;
      rejection='The producer must choose an eligible pitch or reject the slate.';
    }
    else if(!rejection&&personal&&(posting.brief||foundation)&&(![posting.brief,foundation,...rules].some(line=>quoted(line||'',ballot.postingEvidence))||!String(ballot.postingReason||'').trim())){
      needsCorrectBallot=true;
      rejection='The producer must connect the chosen beat to the filmmaker’s own stated publishing taste.';
    }
  }
  const choice=rejection?null:pitches[ballot.index];
  const storyEvidence=choice?{setup:ballot.setupQuote.trim(),payoff:ballot.payoffQuote.trim()}:null;
  book[key]={foundation,postingSignature,stage:choice?'approved':needsCorrectBallot?'voting':'rewrite',pitches,choice,reason:ballot.reason,storyEvidence,postingReason:choice&&personal?ballot.postingReason:'',postingEvidence:choice&&personal?ballot.postingEvidence:'',rejection};
  saveBooking(book);
  return book[key];
}
async function wakeProducer(){
  if(!window.__TAURI__?.core?.invoke||bookingBusy||canonicalWorkerLocked()||CREW.busy||CREW.calling||CREW.refreshPromise||CREW.resumePromise)return;
  bookingBusy=true;
  try{
    if(!producerLeader)producerLeader=await crewInvoke("studio_producer_leader");
    if(!producerLeader)return;
    let book=readBooking();
    const queue=JSON.parse(localStorage.getItem(inboxKey)||'[]');
    if(!book){
      if(productionState()&&['running','starting','rendering','assembling'].includes(productionState().status))return;
      if(!await crewInvoke('double_feature_key_saved'))return;
      const next=queue[0];book=next?bookFilms(next.direction,next.script,next.id,next.options):bookFilms();
    }
    if(book.phase==='complete' && queue.length){
      const next=queue[0];
      book=bookFilms(next.direction,next.script,next.id,next.options);
    }
    if(queue[0]?.id===book.requestId && book.requestId)localStorage.setItem(inboxKey,JSON.stringify(queue.slice(1)));
    if(book.phase==='complete' && book.finishedDay && book.finishedDay!==productionDay() && localStorage.getItem('studio.producer.daily')!=='off'){
      book=bookFilms();book.count=1;saveBooking(book);
    }
    const active=productionState();
    if(typeof tasteLoadSnapshot==='function'){
      if(TASTE_OS.loading)return;
      await tasteLoadSnapshot();
    }
    const foundation=typeof tasteStatement==='function' ? tasteStatement() : '';
    // Keep an unshot, superseded pitch in Projects. Reopen development from
    // the filmmaker's current brief before any storyboard or render spend.
    if(active?.booking?.id===book.id && active.booking.number===book.number && pitchDirectionChanged(active,foundation)){
      active.supersededBooking=active.booking;delete active.booking;
      active.status='superseded';active.currentStep='';active.supersededReason='The filmmaker changed the standing direction before photography.';
      if(!productionCheckpoint())throw Error('Could not preserve the earlier development draft.');
      book.phase='ready';delete book.error;saveBooking(book);return;
    }
    if(active?.booking?.id===book.id && (active.shotReworkQueue||[]).some(item=>!item.completedAt&&!item.queuedAt)
         && ['held','ready','complete'].includes(book.phase) && active.status==='paused'){
      book.phase='ready';delete book.error;saveBooking(book);
      await crewResume();return;
    }
    // An exhausted text repair can be reassigned safely. Media admission and
    // explicit filmmaker stops must never be retried by this path.
    if(book.phase==='held' && active?.booking?.id===book.id && active.booking.number===book.number &&
       ['paused','needs_attention'].includes(active.status) && (/could not self-repair its/.test(book.error||'') || (/review blocked .*storyboard prompt/.test(book.error||'') && crewStoryboardNextRole(active)==='stills_prompt')) && !crewUnprovenJobs(active).length){
      const key=active.id+'/'+book.error.split(' after ')[0];
      book.retries=book.retries||{};
      if((book.retries[key]||0)<2){
        book.retries[key]=(book.retries[key]||0)+1;book.phase='ready';delete book.error;saveBooking(book);
        await crewResume();return;
      }
    }
    if(book.phase==='held' && active?.booking?.id===book.id && active.status==='needs_attention'){
      const role=/^@([^ ]+) returned without changing look\./.exec(book.error||'');
      if(role && crewCommittedLook(active,role[1].replace(/-/g,'_'))){
        book.phase='ready';delete book.error;saveBooking(book);await crewResume();return;
      }
    }
    const meeting=book['commission'+book.number];
    const ownsActiveFilm=active?.booking?.id===book.id && active.booking.number===book.number;
    // Older releases recorded a busy, pre-assignment worker as a failed handoff.
    if(ownsActiveFilm && ['ready','held'].includes(book.phase) && active.status==='needs_attention' &&
       active.error==='Another project worker is running.' && (book.phase==='ready'||book.error===active.error) &&
       !Object.keys(active.jobs||{}).length && !active.images && !active.expectedShotIds?.length){
      book.phase='ready';delete book.error;saveBooking(book);
      await crewResume();return;
    }
    if(book.phase==='held' && !ownsActiveFilm && meeting && !meeting.choice &&
       /timed? out|connection reset|connection refused|temporarily unavailable|HTTP (?:429|502|503|504)\b/i.test(book.error||'')){
      if(!book.pitchRetryAt){
        book.pitchRetryCount=(book.pitchRetryCount||0)+1;
        const delaySeconds=Math.min(900,30*2**Math.min(5,book.pitchRetryCount-1));
        book.pitchRetryAt=Date.now()+1000*delaySeconds;
        saveBooking(book);
      }
      if(Date.now()<book.pitchRetryAt)return;
      delete book.pitchRetryAt;delete book.error;book.phase='ready';saveBooking(book);
    }
    if(['complete','held'].includes(book.phase))return;
    let p=productionState();
    const match=p?.booking?.id===book.id && p.booking.number===book.number;
    if(!match){
      const project=DB.projects.find(pr=>pr.drafts.some(d=>d.state?.production?.booking?.id===book.id&&d.state.production.booking.number===book.number));
      if(project){
        const draft=project.drafts.find(d=>d.state?.production?.booking?.id===book.id&&d.state.production.booking.number===book.number);
        if(activeDraft()&&!persistNow())throw Error('Could not save the open draft.');
        openDraft(project.id,draft.id);return;
      }
      if(p&&['running','starting','rendering','assembling'].includes(p.status))return;
      if(book.textModel==='qwen3.5:latest' && AI.status!=='on'){
        await crewInvoke('studio_local_brain');
        if(!await aiConnect())return;
      }
      let brief=book.direction||'Choose an original film idea.';
      if(book.number===2){
        const first=book.films[0];
        brief+='\nCreate a companion short to '+(first.title||'film one')+'. Carry forward a craft lesson the audience can see in a specific shot. Choose a new subject and story when that better serves the filmmaker. The first film is screening evidence, never a mandatory premise.\nFirst film: '+JSON.stringify(first.scenes||[])+'\nScreening: '+JSON.stringify(first.review);
      }
      const memoryKey='screenings'+book.number;
      if(!book[memoryKey]){
        book[memoryKey]=studioScreenings().slice(0,3);
        if(book.number===2 && book.films[0] && !book[memoryKey].some(row=>row.runId===book.films[0].runId)){
          const {title,runId,review}=book.films[0];
          book[memoryKey].unshift({title,runId,review});
        }
        saveBooking(book);
      }
      brief+=screeningBrief(book[memoryKey]);
      const shelf=JSON.parse(localStorage.getItem('studio.plays.v1')||'[]');
      if(!book.script&&shelf.length){
        const label='shelfChoice'+book.number;
        if(!book[label]){
          const prompt='Choose a play to adapt for the requested film or choose an original. Respect the filmmaker’s direction: '+foundation+'\n'+brief+'\n Return JSON with index (zero-based, -1 for an original) and reason.\n'+JSON.stringify(shelf.map(p=>({name:p.name,opening:p.text.slice(0,1000)})));
          const raw=book.textModel==='qwen3.5:latest'?await aiVisionChat('Producer',prompt,[],book.textModel):await floorChat(book.textModel,'Producer',prompt);
          const choice=aiParseJson(raw);
          if(!Number.isInteger(choice.index)||choice.index< -1||choice.index>=shelf.length)throw Error('The producer returned an unknown play.');
          book[label]=choice.index<0?{reason:choice.reason}:{...shelf[choice.index],reason:choice.reason};saveBooking(book);
        }
        const pick=book[label];
        if(pick.text)brief+='\nAdapt a moment from '+pick.name+' for this short. Preserve the source on the shelf.\n'+pick.text;
      }
      const fromSource=!!(book.script||book.options?.text||book['shelfChoice'+book.number]?.text);
      let commission=null;
      if(!fromSource){
        commission=await commissionOriginal(book,foundation);
        if(book.pitchRetryCount){
          delete book.pitchRetryCount;delete book.pitchRetryAt;saveBooking(book);
        }
        if(!commission.choice)return;
        brief='PRODUCER GREENLIGHT — develop this chosen story: '+JSON.stringify(commission.choice)+'\nProducer’s decision: '+commission.reason+(commission.postingEvidence?'\nPublishing taste: “'+commission.postingEvidence+'” — '+commission.postingReason:'')+'\n'+brief;
      }
      if(foundation)brief='STANDING FILMMAKER DIRECTION (binding): '+foundation+'\n'+brief;
      if(!book.script && !book.options?.targetMinutes)brief+='\nMake exactly two five-second scenes, exactly one shot per scene. Total ten seconds.';
      assigningFilm={id:book.id,number:book.number,foundationAtPitch:foundation,fromSource,commission,screeningSources:book[memoryKey],renderer:book.renderer,textModel:book.textModel,short:!book.script&&!book.options?.targetMinutes};
      if(activeDraft()&&!persistNow())throw Error('Could not save the open draft.');
      if(book.script){
        if(book.script.draftId){
          const project=DB.projects.find(row=>row.id===book.script.projectId);
          const draft=project?.drafts.find(row=>row.id===book.script.draftId);
          if(!draft)throw Error('The queued screenplay draft was removed from Projects.');
          openDraft(project.id,draft.id);
          if(ACTIVE.p!==project.id||ACTIVE.d!==draft.id)throw Error('Could not open the queued screenplay draft.');
          if(draft.needsBreakdown){
            runAutoBreakdown();cardsFromScenes();delete draft.needsBreakdown;
            if(!persistNow())throw Error('Could not save the breakdown.');
          }
        }else{
          // Restore bookings saved by releases that embedded the screenplay.
          if(!crewCreateIdeaProject(book.script.title))throw Error('Could not create the screenplay project.');
          S.title=book.script.title;S.scenes=book.script.scenes;S.scriptName=book.script.filename;
          runAutoBreakdown();cardsFromScenes();if(!persistNow())throw Error('Could not save the imported screenplay.');
        }
        await crewStart('script',brief,{booking:assigningFilm});
      }else await crewStart(book.options?.text?'adaptation':'idea',brief,{targetMinutes:1/6,...book.options,booking:assigningFilm});
      return;
    }
    if(book.directedResume && p.status==='complete'){delete book.directedResume;saveBooking(book);}
    if(book.directedResume && !crewUnprovenJobs(p).length){
      delete book.directedResume;saveBooking(book);await crewResume();return;
    }
    if(p.status==='complete'&&S.cut?.productionRunId===p.id){
      const projectId=ACTIVE.p,draftId=ACTIVE.d;
      const sameFilm=()=>productionState()?.id===p.id && ACTIVE.p===projectId && ACTIVE.d===draftId;
      let review=p.screening;
      if(!review?.observation){
        const sample=async runId=>{
          const result=await floorCall('screen',{runId});
          if(result.images?.length!==4||result.images.some(x=>!x)||result.seconds?.length!==4)throw Error('The screening could not read four timed frames.');
          return result;
        };
        const current=await sample(p.id);
        const companion=book.number===2?book.films[0]:null;
        const prior=companion||(p.booking.screeningSources||[]).find(row=>row.runId&&row.runId!==p.id);
        let previous=null,unavailable='';
        if(prior){
          try {previous=await sample(prior.runId);}
          catch(error){
            if(companion)throw error;
            unavailable=String(error?.message||error);
          }
        }
        if(!sameFilm())return;
        const local=book.textModel==='qwen3.5:latest';
        let earlierObservation=prior?.review?.observation||'',earlierSecond=prior?.review?.currentSecond;
        if(previous&&!previous.seconds.includes(earlierSecond)){
          earlierSecond=null;
          if(local){
            const schema={type:'object',properties:{second:{type:'number',enum:previous.seconds},detail:{type:'string'}},required:['second','detail'],additionalProperties:false};
            const result=aiParseJson(await aiVisionChat('Screening editor','These four timed panels come from one film. Select one panel showing a turning point and describe exactly what is visible in it in one sentence.',[await screeningSheet(previous)],book.textModel,0.2,schema));
            if(previous.seconds.includes(result?.second)&&typeof result.detail==='string'&&result.detail.trim()){
              earlierSecond=result.second;earlierObservation=result.detail;
            }
          }
        }
        if(!sameFilm())return;
        const images=[await screeningSheet(current)];
        const content='All four panels are from the current film, '+S.title+'. The time is printed above each panel. Read them like a page. Describe an object or gesture visible at one supplied time. Judge whether the hook and payoff are legible. Give the next director one specific experiment. Stills cannot prove camera settings, motion between frames, sound or audience retention.'+
          (postingTaste().brief?' Which specific visible detail makes this scene? Use the filmmaker’s publishing brief to guide the next experiment. Cite what the frames support: '+postingTaste().brief+'\n':'')+
          (previous?' The editor of the earlier film, '+prior.title+', recorded: '+earlierObservation+
            '. Previous lesson to test: '+(prior.review?.lesson||'')+'. Filmmaker feedback on that film: '+JSON.stringify(prior.filmmakerNotes||[])+
            '. The earlier account belongs to a different film. Compare the visible outcome in this film against that account. Include a reason; use partial when only part is visible, and unproven when the evidence cannot answer.':'');
        if(!sameFilm())return;
        const fields={
          currentSecond:{type:'number',enum:current.seconds,description:'Time printed on the current film panel being cited.'},
          observation:{type:'string',description:'One concrete detail directly visible in the chosen current panel. Exclude offscreen actions.'},
          nextAction:{type:'string',description:'Direct the next shoot in one imperative sentence: change something specific in blocking, framing, timing or staging.'},
          successCheck:{type:'string',description:'A visible result a viewer should be able to point to if the experiment succeeds.'}
        };
        if(previous){
          fields.verdict={type:'string',enum:['visible','partial','unproven']};
          fields.evidence={type:'string',description:'Identify what the current frame supports relative to the earlier editor’s account. Distinguish what the frames show from how the shot may have been made.'};
        }
        const schema={type:'object',properties:fields,required:Object.keys(fields),additionalProperties:false};
        const role='You are the screening editor. Describe only visible evidence.';
        const raw=book.textModel==='qwen3.5:latest'?await aiVisionChat(role,content,images,book.textModel,0.2,schema):
          await floorChat(book.textModel,role,content,images,true,{schema});
        review=aiParseJson(raw);
        const hasText=k=>typeof review?.[k]==='string' && review[k].trim();
        if(!sameFilm())return;
        if(!current.seconds.includes(review?.currentSecond))throw Error('The editor must cite a time from the sampled frames.');
        if(!hasText('observation')||!hasText('nextAction')||!hasText('successCheck')||(previous&&(!hasText('evidence')||!['visible','partial','unproven'].includes(review.verdict))))throw Error('The screening returned incomplete evidence.');
        review.lesson=review.nextAction.trim()+' Check the result: '+review.successCheck.trim();
        if(prior){
          review.comparedWith={runId:prior.runId,title:prior.title};
          if(previous&&Number.isFinite(earlierSecond))review.earlierSecond=earlierSecond;
          else {
            delete review.earlierSecond;
            review.verdict='unproven';
            if(!unavailable)review.evidence='The earlier review has no verified frame time. '+review.evidence;
          }
          if(unavailable){review.verdict='unproven';review.evidence='Studio could not screen the earlier cut. '+unavailable;}
        }
        p.screening=review;
        if(!productionCheckpoint()){delete p.screening;throw Error('Could not save the screening.');}
      }
      const note=[review.observation,review.comparedWith&&('Compared with '+review.comparedWith.title),review.verdict,review.evidence,review.lesson].filter(Boolean).join('\n');
      const event=await crewSendConversation({eventId:'screen_'+p.id,eventType:'reply',intent:'fyi',fromRoleId:'editor',toRoleId:'director',summary:'The editor screened '+S.title,details:note,actionRequested:'Use this screening as evidence in the next film.'});
      await crewFinishConversation(event,'ack');
      if(!sameFilm())return;
      book.films.push({runId:p.id,title:S.title,projectId:ACTIVE.p,draftId:ACTIVE.d,path:S.cut.outputPath,scenes:S.scenes.map(sc=>({slug:sc.slug,summary:sc.synopsis,shots:sc.shots.map(sh=>({id:sh.id,description:sh.desc}))})),review});
      if(book.number===(book.count||2)){book.phase='complete';book.finishedDay=productionDay();}else book.number=2;
      saveBooking(book);return;
    }
    if(p.status==='paused'&&p.interruptedAt&&!p.error){delete p.interruptedAt;await crewResume();return;}
    if(p.status==='needs_attention'&&!crewUnprovenJobs(p).length){
      const reason=p.error||'';
      const beforeShoot=!Object.keys(p.jobs||{}).length&&!p.images?.done;
      const temporary=/another worker owns|timed out|connection unavailable before submission|temporarily unavailable|HTTP (429|50[0234])|connection reset/i.test(reason);
      const correctable=beforeShoot && /returned|invalid|schema|incomplete|requested revision without|missing .*field|requires? .*scene|must (?:include|contain|return|use)/i.test(reason);
      const attempts=book.retries||{};
      const lastFailure=Object.keys(p.steps||{}).find(k=>p.steps[k].status==='failed')||'producer';
      const key=p.id+'/'+lastFailure;
      if((temporary||correctable)&&(attempts[key]||0)<3){
        if(!book.retryAt){book.retryAt=Date.now()+(temporary?30000:3000);saveBooking(book);return;}
        if(Date.now()<book.retryAt)return;
        attempts[key]=(attempts[key]||0)+1;book.retries=attempts;delete book.retryAt;saveBooking(book);
        const instruction='Correct the last failed handoff before continuing: '+reason;
        p.brief=p.brief.split('\nCorrection from production:')[0]+'\nCorrection from production: '+instruction;
        if(!productionCheckpoint())throw Error('Could not save the correction.');
        await crewResume();return;
      }
    }
    if(['needs_attention','cancelled','paused'].includes(p.status)){book.phase='held';book.error=p.error||p.status;saveBooking(book);return;}
    if(!CREW.pollTimer)await crewResume();
  }catch(e){
    const book=readBooking();if(book){book.phase='held';book.error=String(e.message||e);saveBooking(book);}
    toast(String(e.message||e));
  }finally{assigningFilm=null;bookingBusy=false;}
}
