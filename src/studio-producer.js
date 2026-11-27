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
async function commissionOriginal(book,foundation){
  const key='commission'+book.number;
  const existing=book[key];
  if(existing?.choice && existing.foundation===foundation)return existing;
  const consult=async(role,prompt,temperature)=>{
    const raw=book.textModel==='qwen3.5:latest'?await aiVisionChat(role,prompt,[],book.textModel,temperature):
      await floorChat(book.textModel,role,prompt,[],true,{temperature});
    return aiParseJson(raw);
  };
  const mandate='Filmmaker’s words, binding: '+foundation+'\nFilm-specific direction: '+(book.direction||'Crew original.')+
    '\nRunning time: '+(book.options?.targetMinutes?book.options.targetMinutes*60:10)+' seconds.';
  const lessons=screeningBrief(book['screenings'+book.number],true);
  const prior=existing?.rejection||'';
  const slate=await consult('Director in a film studio pitch meeting',mandate+lessons+
    '\nPitch three genuinely different stories to the producer before any camera decisions. Write the actual image, line or action that hooks a viewer, the specific human tension or comic premise, and the payoff. Let the genre and the filmmaker guide you. A demonstration of materials or a predictable chain reaction does not constitute a story unless the filmmaker explicitly requests it. Let the current brief supply the characters, objects and world. A previous film’s craft note can change how this story reads. Only reuse its story elements when they serve this brief. Plant what the ending depends on. Describe actions a viewer can follow in the available seconds. No camera specs. Return JSON with pitches, each containing title, opening, ending, and whyWatch.'+
    (prior?'\nProducer rejected the previous slate because: '+prior:''),0.9);
  if(!Array.isArray(slate.pitches)||slate.pitches.length!==3||slate.pitches.some(p=>!['title','opening','ending','whyWatch'].every(k=>typeof p[k]==='string'&&p[k].trim())))
    throw Error('The director returned an incomplete pitch slate.');
  const pages=slate.pitches.map(({title,opening,ending})=>({title,opening,ending}));
  const ballot=await consult('Independent commissioning producer',mandate+lessons+
    '\nRead only what a viewer will see. What makes the opening worth staying for? What in that opening earns the ending? A coincidence, an unintroduced prop solving the story, or physically incompatible actions need another pitch. Surreal and observational films can earn the ending through a legible visual or emotional connection. Check whether someone can read the change in the allotted time. An earlier film’s prop or technique is never evidence for a beat on these pages.'+
    '\nReturn JSON with index (0, 1, 2 or -1 to reject all) and reason. For a selection also include setupQuote copied exactly from opening, payoffQuote copied exactly from ending, and blockingGap (an empty string only if there is no missing connection). In reason explain how those specific beats connect and why watching the payoff matters. If all three need a missing event to work, reject all and explain what to fix.\n'+JSON.stringify(pages),0.35);
  if(!Number.isInteger(ballot.index)||ballot.index< -1||ballot.index>2||!String(ballot.reason||'').trim())throw Error('The producer returned an incomplete commissioning decision.');
  const pick=pages[ballot.index];
  let rejection=pick?'':ballot.reason;
  if(pick){
    const quoted=(line,quote)=>typeof quote==='string' && quote.trim().length>=3 && line.includes(quote.trim());
    if(typeof ballot.blockingGap!=='string' || !quoted(pick.opening,ballot.setupQuote) || !quoted(pick.ending,ballot.payoffQuote)){
      rejection='The producer must identify the setup and payoff in the actual pitch before commissioning it.';
    }else if(ballot.blockingGap.trim())rejection=ballot.blockingGap.trim();
  }
  const choice=rejection?null:slate.pitches[ballot.index];
  const storyEvidence=choice?{setup:ballot.setupQuote.trim(),payoff:ballot.payoffQuote.trim()}:null;
  book[key]={foundation,pitches:slate.pitches,choice,reason:ballot.reason,storyEvidence,rejection};
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
        if(!commission.choice)return;
        brief='PRODUCER GREENLIGHT — develop this chosen story: '+JSON.stringify(commission.choice)+'\nProducer’s decision: '+commission.reason+'\n'+brief;
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
        const prior=book.number===2?book.films[0]:null;
        const previous=prior?await sample(prior.runId):null;
        const content='Filmmaker direction: '+foundation+'\nFilm brief: '+p.brief+'\nThe screenplay editor expected: '+JSON.stringify(p.writerWork?.review?.audience||{})+
          '\nRead the opening and payoff as a viewer. Identify what is legible or confusing in the sampled images. Cite a supplied time for the observation. Give one concrete, testable adjustment for the next director in lesson. Stills cannot establish audio, audience retention, or what happened between samples.'+
          (prior?'\nFirst four images: '+prior.title+' at '+previous.seconds.join(', ')+' seconds. Its review: '+JSON.stringify(prior.review)+'. Next four: this film at '+current.seconds.join(', ')+' seconds. Compare the intended change against both sets. Return JSON with observation, lesson, verdict (visible, partial or unproven), and evidence citing both films.':
          '\nThis film at '+current.seconds.join(', ')+' seconds. Return JSON with observation and lesson.');
        const images=previous?[...previous.images,...current.images]:current.images;
        if(!sameFilm())return;
        const raw=book.textModel==='qwen3.5:latest'?await aiVisionChat('Screening editor',content,images,book.textModel):await floorChat(book.textModel,'You are the screening editor. Describe only visible evidence.',content,images);
        review=aiParseJson(raw);
        const hasText=k=>typeof review?.[k]==='string' && review[k].trim();
        if(!hasText('observation')||!hasText('lesson')||(prior&&(!hasText('evidence')||!['visible','partial','unproven'].includes(review.verdict))))throw Error('The screening returned incomplete evidence.');
        if(!sameFilm())return;
        p.screening=review;
        if(!productionCheckpoint()){delete p.screening;throw Error('Could not save the screening.');}
      }
      const note=Object.values(review).join('\n');
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
