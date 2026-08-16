import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/modules/studio-town/assets/town-assets.json'), 'utf8'));
const canonicalRoles = [
  'producer','director','story_editor','writer','script_supervisor','taste','first_ad','dp','camera_operator','gaffer','key_grip',
  'production_designer','location_scout','prop_master','costume_designer','casting_director','colorist','prompt_writer','stills_prompt',
  'stills','second_unit','composer','editor'
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadTownModules() {
  const context = { console, Date, Math, Set, Map, Object, Array, String, Number, Boolean, JSON };
  context.globalThis = context;
  for (const name of ['town-layout.js','town-model.js','town-simulation.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root,'src/modules/studio-town',name),'utf8'), context, {filename:name});
  }
  return context;
}

function role(id) {
  return { id, at:id.replaceAll('_','-'), title:id, dept:'test', mod:'test', job:'real job', owns:'S.'+id };
}

test('Studio Town imports the approved map and exactly one corrected frame set for all 23 agents', () => {
  assert.equal(manifest.schema, 'agentic-movie-studio/studio-town-assets@1');
  assert.deepEqual(manifest.roles.map(row=>row.roleId), canonicalRoles);
  assert.deepEqual(manifest.frameIds, ['idle','walk_left','walk_right','talk']);
  const mapFile=path.join(root,'src/modules/studio-town/assets/studio-town.png');
  assert.equal(manifest.map.width,1672);assert.equal(manifest.map.height,941);
  assert.equal(sha256(mapFile),manifest.map.sha256);
  for(const row of manifest.roles){
    assert.equal(Object.keys(row.frames).length,4,row.roleId);
    for(const [frameId,frame] of Object.entries(row.frames)){
      const file=path.join(root,'src/modules/studio-town/assets/crew',row.roleId,frameId+'.png');
      assert.equal(sha256(file),frame.sha256,row.roleId+':'+frameId);
      assert.equal(frame.edgeOpaquePixels,0,row.roleId+':'+frameId+' must not be clipped at an edge');
      assert.ok(frame.bottomPadding>=12,row.roleId+':'+frameId+' must keep full feet and clearance');
      assert.ok(frame.bounds.height>0&&frame.bounds.width>0,row.roleId+':'+frameId+' must contain a sprite');
    }
  }
});

test('the town layout assigns every canonical agent to a real clickable workplace', () => {
  const {StudioTownLayout:layout}=loadTownModules();
  assert.deepEqual([...Object.keys(layout.roleBuildings)].sort(),[...canonicalRoles].sort());
  assert.equal(new Set(layout.buildings.map(row=>row.id)).size,layout.buildings.length);
  for(const roleId of canonicalRoles){
    const home=layout.roleHome(roleId),building=layout.buildingForRole(roleId);
    assert.ok(layout.buildingById[home.buildingId]);
    assert.equal(building.id,home.buildingId);
    assert.ok(Number.isFinite(home.x)&&Number.isFinite(home.y));
  }
  assert.equal(layout.buildingById.client.view,'client');
  assert.equal(layout.buildingById.taste.view,'tasteos');
  assert.equal(layout.buildingById.media.action,'settings');
});

test('town activity is derived only from canonical work, human review, and durable messages', () => {
  const {StudioTownLayout:layout,StudioTownModel:model}=loadTownModules();
  const roster=canonicalRoles.map(role);
  const base={layout,roster,projectId:'p',draftId:'d',title:'Film',services:{},nowMs:Date.parse('2026-08-16T05:00:10Z')};
  let view=model.deriveTownVM({...base,production:null,transcript:[]});
  assert.equal(view.total,23);assert.ok(view.agents.every(agent=>agent.activity==='idle'));
  assert.ok(view.agents.every(agent=>agent.lastMessage===''));
  assert.equal(view.events.length,0);

  const production={id:'run',status:'running',currentStep:'writer',steps:{writer:{status:'running',startedAt:'2026-08-16T05:00:00Z'}}};
  view=model.deriveTownVM({...base,production,busyAt:'writer',transcript:[]});
  assert.equal(view.agents.find(agent=>agent.roleId==='writer').activity,'work');
  assert.equal(view.agents.find(agent=>agent.roleId==='director').activity,'idle');

  production.currentStep='';production.status='paused';production.steps.writer={status:'done',out:'A real screenplay checkpoint.',updatedAt:'2026-08-16T05:00:05Z'};
  view=model.deriveTownVM({...base,production,transcript:[{id:'writer-1',roleId:'writer',kind:'agent',status:'done',at:'2026-08-16T05:00:05Z',text:'A real screenplay checkpoint.'}]});
  const writer=view.agents.find(agent=>agent.roleId==='writer');
  assert.equal(writer.activity,'talk');assert.equal(writer.lastMessage,'A real screenplay checkpoint.');

  production.steps.writer.review={verdict:'revise',note:'Make the action visual.',at:'2026-08-16T05:00:07Z'};
  view=model.deriveTownVM({...base,production,transcript:[]});
  assert.equal(view.agents.find(agent=>agent.roleId==='writer').activity,'review');
  assert.equal(view.agents.find(agent=>agent.roleId==='writer').buildingId,'screening');

  production.status='needs_attention';production.currentStep='story_review';production.steps.story_review={status:'failed',error:'Review failed.'};
  view=model.deriveTownVM({...base,production,transcript:[]});
  assert.equal(view.currentRoleId,'story_editor');
  assert.equal(view.agents.find(agent=>agent.roleId==='story_editor').activity,'blocked');
});

test('real direction, producer handoff, and rework become typed town events', () => {
  const {StudioTownLayout:layout,StudioTownModel:model}=loadTownModules();
  const production={id:'run',status:'paused',steps:{},orchestration:{decisions:[{at:'2026-08-16T05:00:02Z',nextRole:'director',reason:'Treatment is next.',clientUpdate:'Producer assigned the director.'}]},
    reworkQueue:[{id:'rw1',roleId:'writer',requestedAt:'2026-08-16T05:00:03Z',note:'Use visible action.'}]};
  const events=model.deriveEvents({layout,roster:canonicalRoles.map(role),projectId:'p',production,
    transcript:[{id:'client1',kind:'client',targetRoleId:'director',at:'2026-08-16T05:00:01Z',text:'Keep the room ordinary.'}]});
  assert.equal(events[0].type,'request');assert.equal(JSON.stringify(events[0].toRoleIds),JSON.stringify(['director']));
  assert.equal(events[1].type,'handoff');assert.equal(events[1].fromRoleId,'producer');
  assert.equal(events[2].type,'rework');assert.equal(JSON.stringify(events[2].toRoleIds),JSON.stringify(['writer']));
});

test('sprite travel begins only when a new durable routing event appears', () => {
  const {StudioTownLayout:layout,StudioTownSimulation}=loadTownModules();
  const simulation=new StudioTownSimulation.TownSimulation(layout,{speed:500});
  const agents=canonicalRoles.map(id=>({...role(id),roleId:id,buildingId:layout.roleBuildings[id],homeBuildingId:layout.roleBuildings[id],activity:'idle'}));
  simulation.update({agents,events:[]},1000);
  assert.ok(simulation.snapshot().every(state=>!state.moving));
  simulation.update({agents,events:[{id:'handoff-1',type:'handoff',fromRoleId:'producer',toRoleIds:['director']}]},1200);
  assert.equal(simulation.snapshot().find(state=>state.roleId==='producer').moving,true);
  assert.ok(simulation.snapshot().filter(state=>state.roleId!=='producer').every(state=>!state.moving));
  simulation.update({projectId:'other',draftId:'draft',runId:'run-2',agents,events:[]},1400);
  assert.ok(simulation.snapshot().every(state=>!state.moving),'switching canonical owners must reset instead of animating stale state');
});

test('Studio Town and Client Room are first-class local app views, not iframes or demos', () => {
  assert.match(html, /data-view="town" title="Studio Town"/);
  assert.match(html, /data-view="client" title="Client Room"/);
  assert.match(html, /id="view-town"[\s\S]*id="townWrap"/);
  assert.match(html, /id="view-client"[\s\S]*id="clientWrap"/);
  assert.doesNotMatch(html, /id="view-town"[\s\S]{0,500}<iframe/);
  for(const file of ['town-assets.js','town-layout.js','town-model.js','town-simulation.js','town-renderer.js','town-controller.js']) assert.match(html,new RegExp('modules/studio-town/(?:assets/)?'+file.replace('.','\\.')));
  assert.match(html,/if \(v==='town'\) renderTown\(\)/);
  assert.match(html,/if \(v==='client'\) renderClientRoom\(\)/);
  assert.match(html,/crewAddClientNote\(text,targetRoleId\)/);
  assert.match(html,/TO @/);
});

test('Town UI provides DOM-based access, exact status, review, direction, and skill controls', () => {
  const controller=fs.readFileSync(path.join(root,'src/modules/studio-town/town-controller.js'),'utf8');
  assert.match(controller,/role="img" tabindex="0" aria-label="Live Agentic Movie Studio town/);
  assert.match(controller,/All 23 agents/);
  assert.match(controller,/Durable event record/);
  assert.match(controller,/Skill book/);
  assert.match(controller,/Flag & rework/);
  assert.match(controller,/Send direction/);
  assert.match(controller,/Read full checkpoint/);
  assert.match(controller,/data-town-direction/);
  assert.doesNotMatch(controller,/Math\.random|ambient chatter|wander/i);
  assert.match(html,/crewConnect\(\)\.then\(\(\)=>\{[\s\S]{0,320}activeView\(\)==='town'/);
});
