(function (root) {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }

  function statusLabel(value) { return String(value || 'idle').replace(/_/g,' '); }

  class StudioTownController {
    constructor(container, options) {
      if (!container) throw new Error('Studio Town controller requires a mount point.');
      this.container=container;
      this.options=options||{};
      this.layout=this.options.layout||root.StudioTownLayout;
      this.assets=this.options.assets||root.STUDIO_TOWN_ASSETS;
      this.vm=null;this.active=false;this.timer=0;this.selectedRoleId='';this.loaded=false;
      this.reducedMotion=!!(root.matchMedia&&root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.mount();
    }

    mount() {
      this.container.innerHTML='<section class="studio-town-shell" data-town-ui>'
        +'<header class="studio-town-toolbar">'
        +'<div><h3>Studio Town</h3><p id="townProductionSummary">Waiting for the canonical project state.</p></div>'
        +'<div class="studio-town-health" id="townHealth" aria-label="Service health"></div>'
        +'<div class="studio-town-tools">'
        +'<button class="btn small" data-town-ui id="townZoomOut" title="Zoom out" aria-label="Zoom out">−</button>'
        +'<button class="btn small" data-town-ui id="townFit" title="Fit town to window">Fit</button>'
        +'<button class="btn small" data-town-ui id="townZoomIn" title="Zoom in" aria-label="Zoom in">+</button>'
        +'<button class="btn small" data-town-ui id="townRefresh">Refresh record</button>'
        +'</div></header>'
        +'<div class="studio-town-workspace">'
        +'<div class="studio-town-stage"><canvas id="studioTownCanvas" role="img" tabindex="0" aria-label="Live Agentic Movie Studio town. Use the accessible crew list beside the map to inspect every agent."></canvas>'
        +'<div class="studio-town-legend"><span><i class="work"></i>working</span><span><i class="review"></i>review</span><span><i class="blocked"></i>blocked</span><span><i class="complete"></i>complete</span></div></div>'
        +'<aside class="studio-town-inspector" aria-label="Studio Town inspector">'
        +'<label class="studio-town-building-jump"><span>Open a building</span><select id="townBuildingSelect" data-town-ui><option value="">Choose…</option>'
        +this.layout.buildings.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.label)+'</option>').join('')+'</select></label>'
        +'<div id="townAgentDrawer"></div>'
        +'<details class="studio-town-crew-list" open><summary>All 23 agents</summary><div id="townCrewList"></div></details>'
        +'<details class="studio-town-event-list"><summary>Durable event record</summary><div id="townEventList"></div></details>'
        +'</aside></div><div class="sr-only" id="townLiveRegion" aria-live="polite"></div></section>';

      const canvas=this.container.querySelector('#studioTownCanvas');
      this.simulation=new root.StudioTownSimulation.TownSimulation(this.layout,{reducedMotion:this.reducedMotion});
      this.renderer=new root.StudioTownRenderer.TownRenderer(canvas,{
        assets:this.assets,layout:this.layout,simulation:this.simulation,
        onAgent:roleId=>this.selectRole(roleId),onBuilding:id=>this.openBuilding(id)
      });
      this.renderer.load().then(()=>{this.loaded=true;this.renderer.setActive(this.active);}).catch(error=>{
        const stage=this.container.querySelector('.studio-town-stage');
        if(stage) stage.insertAdjacentHTML('beforeend','<div class="studio-town-error">'+esc(error.message)+'</div>');
        if(this.options.onError) this.options.onError(error);
      });
      this.container.querySelector('#townZoomOut').addEventListener('click',()=>this.renderer.zoomBy(.85));
      this.container.querySelector('#townZoomIn').addEventListener('click',()=>this.renderer.zoomBy(1.18));
      this.container.querySelector('#townFit').addEventListener('click',()=>this.renderer.fit());
      this.container.querySelector('#townRefresh').addEventListener('click',()=>this.options.onRefresh&&this.options.onRefresh());
      this.container.querySelector('#townBuildingSelect').addEventListener('change',event=>this.openBuilding(event.target.value));
    }

    setActive(active) {
      this.active=!!active;
      if(this.renderer) this.renderer.setActive(this.active&&this.loaded);
      if(this.active){this.refresh();this.schedule();}else if(this.timer){clearTimeout(this.timer);this.timer=0;}
    }

    schedule() {
      if(this.timer) clearTimeout(this.timer);
      if(!this.active)return;
      this.timer=setTimeout(()=>{this.timer=0;this.refresh();this.schedule();},750);
    }

    refresh() {
      if(!this.options.getViewModel)return;
      const vm=this.options.getViewModel(this.selectedRoleId);
      if(!vm)return;
      const previous=this.vm&&this.vm.latestEvent&&this.vm.latestEvent.id;
      this.vm=vm;
      if(!this.selectedRoleId)this.selectedRoleId=vm.currentRoleId||'producer';
      vm.selectedRoleId=this.selectedRoleId;
      this.renderer.update(vm);
      this.renderDom();
      const latest=vm.latestEvent;
      if(latest&&latest.id!==previous){
        const live=this.container.querySelector('#townLiveRegion');
        if(live)live.textContent=latest.text||latest.type+' event recorded.';
      }
    }

    selectRole(roleId) {
      this.selectedRoleId=String(roleId||'');
      if(this.vm)this.vm.selectedRoleId=this.selectedRoleId;
      this.renderer.selectRole(this.selectedRoleId);
      this.renderDom();
    }

    openBuilding(id) {
      const building=this.layout.buildingById[id];
      if(!building)return;
      if(building.action==='settings'&&this.options.onSettings)this.options.onSettings();
      else if(building.view&&this.options.onNavigate)this.options.onNavigate(building.view);
    }

    renderDom() {
      const vm=this.vm;if(!vm)return;
      const summary=this.container.querySelector('#townProductionSummary');
      if(summary)summary.textContent=vm.title+' · '+statusLabel(vm.productionStatus)+' · '+vm.finished+' of '+vm.total+' departments complete';
      const health=this.container.querySelector('#townHealth');
      if(health)health.innerHTML=(vm.services||[]).map(row=>'<span class="'+(row.ok?'ok':'bad')+'" title="'+esc(row.detail||'')+'"><i></i>'+esc(row.name)+'</span>').join('');
      const list=this.container.querySelector('#townCrewList');
      if(list)list.innerHTML=(vm.agents||[]).map(agent=>'<button data-town-ui data-town-agent="'+esc(agent.roleId)+'" class="studio-town-agent-row '+(agent.roleId===this.selectedRoleId?'selected':'')+'">'
        +'<span class="studio-town-dot '+esc(agent.activity)+'"></span><span><b>@'+esc(agent.at)+'</b><small>'+esc(agent.title)+'</small></span><em>'+esc(statusLabel(agent.activity))+'</em></button>').join('');
      list&&list.querySelectorAll('[data-town-agent]').forEach(button=>button.addEventListener('click',()=>this.selectRole(button.dataset.townAgent)));
      this.renderDrawer();this.renderEvents();
    }

    renderDrawer() {
      const drawer=this.container.querySelector('#townAgentDrawer');if(!drawer||!this.vm)return;
      const agent=this.vm.agents.find(row=>row.roleId===this.selectedRoleId)||this.vm.agents[0];
      if(!agent){drawer.innerHTML='<div class="studio-town-empty">No canonical crew roster is loaded.</div>';return;}
      const fullStatus=String(agent.statusText||''),preview=fullStatus.length>760?fullStatus.slice(0,760).trimEnd()+'…':fullStatus;
      drawer.innerHTML='<article class="studio-town-agent-card">'
        +'<div class="studio-town-agent-head"><span class="studio-town-dot '+esc(agent.activity)+'"></span><div><h4>@'+esc(agent.at)+'</h4><p>'+esc(agent.title)+' · '+esc(agent.department)+'</p></div><span class="ai-badge">'+esc(statusLabel(agent.activity))+'</span></div>'
        +'<p class="studio-town-agent-status">'+esc(preview)+'</p>'
        +(fullStatus.length>760?'<details class="studio-town-full-status"><summary>Read full checkpoint</summary><pre>'+esc(fullStatus)+'</pre></details>':'')
        +'<dl><div><dt>Owns</dt><dd>'+esc(agent.owns)+'</dd></div><div><dt>Module</dt><dd>'+esc(agent.module)+'</dd></div>'+(agent.provider?'<div><dt>Provider</dt><dd>'+esc(agent.provider.name||agent.provider.id||agent.provider)+'</dd></div>':'')+'</dl>'
        +'<div class="studio-town-actions">'
        +'<button class="btn small" data-town-ui id="townSkill">Skill book</button>'
        +(agent.artifact&&agent.artifact.view?'<button class="btn small" data-town-ui id="townOpenArtifact">Open artifact</button>':'')
        +(agent.canRun?'<button class="btn small" data-town-ui id="townRunAgent">Run department</button>':'')+'</div>'
        +(agent.artifact?'<div class="studio-town-review"><b>Human review</b><textarea rows="2" data-town-direction id="townReviewNote" placeholder="What must this department keep or change?"></textarea><div><button class="btn small" data-town-ui id="townKeep">Keep</button><button class="btn small danger" data-town-ui id="townRevise">Flag & rework</button></div></div>':'')
        +'<div class="studio-town-direction"><b>Direction to @'+esc(agent.at)+'</b><textarea rows="3" data-town-direction id="townDirection" placeholder="Give this department a precise instruction for its next checkpoint."></textarea><button class="btn primary small" data-town-ui id="townSendDirection">Send direction</button></div>'
        +'</article>';
      const on=(id,fn)=>{const node=drawer.querySelector('#'+id);if(node)node.addEventListener('click',fn);};
      on('townSkill',()=>this.options.onSkill&&this.options.onSkill(agent.roleId));
      on('townOpenArtifact',()=>this.options.onNavigate&&this.options.onNavigate(agent.artifact.view));
      on('townRunAgent',()=>this.options.onRun&&this.options.onRun(agent.roleId));
      on('townKeep',()=>this.options.onReview&&this.options.onReview(agent.roleId,'keep',(drawer.querySelector('#townReviewNote')||{}).value||''));
      on('townRevise',()=>{
        const note=String((drawer.querySelector('#townReviewNote')||{}).value||'').trim();
        if(!note){this.options.onNotice&&this.options.onNotice('Tell the department what must change.');return;}
        this.options.onReview&&this.options.onReview(agent.roleId,'revise',note);
      });
      on('townSendDirection',()=>{
        const input=drawer.querySelector('#townDirection'),text=String((input||{}).value||'').trim();
        if(this.options.onDirection&&this.options.onDirection(agent.roleId,text)!==false&&input)input.value='';
      });
    }

    renderEvents() {
      const wrap=this.container.querySelector('#townEventList');if(!wrap||!this.vm)return;
      const rows=(this.vm.events||[]).slice(-30).reverse();
      wrap.innerHTML=rows.length?rows.map(row=>'<article><b>'+esc(row.type)+'</b><span>'+esc(row.fromRoleId||'system')+(row.toRoleIds.length?' → '+row.toRoleIds.map(id=>'@'+id).join(', '):'')+'</span><p>'+esc(row.text||row.status)+'</p><time>'+esc(row.createdAt?new Date(row.createdAt).toLocaleString():'')+'</time></article>').join(''):'<p class="studio-town-empty">No durable production events yet.</p>';
    }
  }

  root.StudioTownController = Object.freeze({ StudioTownController, esc });
})(globalThis);
