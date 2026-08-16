(function (root) {
  'use strict';

  const STATUS = Object.freeze({
    blocked:{ color:'#d96868', symbol:'!', label:'blocked' },
    review:{ color:'#f0b35d', symbol:'?', label:'human review' },
    work:{ color:'#62b9da', symbol:'…', label:'working' },
    talk:{ color:'#a88be0', symbol:'›', label:'speaking' },
    complete:{ color:'#71c892', symbol:'✓', label:'complete' },
    idle:{ color:'#8b93a3', symbol:'·', label:'idle' }
  });

  function image(src) {
    return new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Could not load Studio Town asset: '+src));
      node.src = src;
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+width-r,y); ctx.quadraticCurveTo(x+width,y,x+width,y+r);
    ctx.lineTo(x+width,y+height-r); ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
    ctx.lineTo(x+r,y+height); ctx.quadraticCurveTo(x,y+height,x,y+height-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }

  class TownRenderer {
    constructor(canvas, options) {
      if (!canvas) throw new Error('Studio Town renderer requires a canvas.');
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha:false });
      this.options = options || {};
      this.assets = this.options.assets || root.STUDIO_TOWN_ASSETS;
      this.layout = this.options.layout || root.StudioTownLayout;
      this.simulation = this.options.simulation;
      this.images = new Map();
      this.vm = null;
      this.active = false;
      this.zoom = 1;
      this.pan = {x:0,y:0};
      this.hoverBuildingId = '';
      this.hoverRoleId = '';
      this.selectedRoleId = '';
      this.lastFrame = 0;
      this.raf = 0;
      this.drag = null;
      this.viewport = {scale:1,tx:0,ty:0,width:1,height:1,dpr:1};
      this.bind();
    }

    async load() {
      const queue = [['map', this.assets.map.src]];
      for (const role of this.assets.roles || []) {
        for (const [frameId, frame] of Object.entries(role.frames || {})) queue.push([role.roleId+':'+frameId, frame.src]);
      }
      const loaded = await Promise.all(queue.map(async ([key, src]) => [key, await image(src)]));
      loaded.forEach(([key, node]) => this.images.set(key, node));
      this.draw();
      return this;
    }

    bind() {
      this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
      if (this.resizeObserver) this.resizeObserver.observe(this.canvas);
      root.addEventListener && root.addEventListener('resize', () => this.resize());
      this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
      this.canvas.addEventListener('pointerdown', event => {
        this.drag = {x:event.clientX,y:event.clientY,panX:this.pan.x,panY:this.pan.y,moved:false};
        this.canvas.setPointerCapture && this.canvas.setPointerCapture(event.pointerId);
      });
      this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
      this.canvas.addEventListener('pointerleave', () => { this.hoverBuildingId=''; this.hoverRoleId=''; this.draw(); });
      this.canvas.addEventListener('wheel', event => {
        event.preventDefault();
        this.zoomBy(event.deltaY < 0 ? 1.14 : 0.88);
      }, {passive:false});
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, root.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width; this.canvas.height = height;
      }
      this.viewport.dpr = dpr;
      this.draw();
    }

    update(vm) {
      this.vm = vm;
      this.simulation.update(vm, Date.now());
      this.selectedRoleId = vm && vm.selectedRoleId || this.selectedRoleId;
      this.draw();
    }

    setActive(active) {
      this.active = !!active;
      if (this.active && !this.raf) {
        this.lastFrame = performance.now();
        this.raf = requestAnimationFrame(time => this.loop(time));
      } else if (!this.active && this.raf) {
        cancelAnimationFrame(this.raf); this.raf = 0;
      }
      this.draw();
    }

    loop(time) {
      if (!this.active) { this.raf=0; return; }
      const delta = time - this.lastFrame; this.lastFrame = time;
      this.simulation.nowMs = Date.now();
      this.simulation.tick(delta);
      this.draw();
      this.raf = requestAnimationFrame(next => this.loop(next));
    }

    fit() { this.zoom=1; this.pan={x:0,y:0}; this.draw(); }
    zoomBy(amount) { this.zoom=Math.max(0.75,Math.min(3.2,this.zoom*amount)); this.draw(); }
    selectRole(roleId) { this.selectedRoleId=String(roleId||''); this.draw(); }

    transform() {
      const dpr = this.viewport.dpr || 1;
      const width = this.canvas.width / dpr, height = this.canvas.height / dpr;
      const base = Math.min(width / this.layout.map.width, height / this.layout.map.height);
      const scale = base * this.zoom;
      const tx = (width - this.layout.map.width * scale) / 2 + this.pan.x;
      const ty = (height - this.layout.map.height * scale) / 2 + this.pan.y;
      this.viewport = {dpr,width,height,scale,tx,ty};
      return this.viewport;
    }

    worldPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      const view = this.transform();
      return {x:(event.clientX-rect.left-view.tx)/view.scale,y:(event.clientY-rect.top-view.ty)/view.scale};
    }

    pointerMove(event) {
      if (this.drag && (event.buttons & 1)) {
        const dx=event.clientX-this.drag.x,dy=event.clientY-this.drag.y;
        if (Math.abs(dx)+Math.abs(dy)>3) this.drag.moved=true;
        this.pan={x:this.drag.panX+dx,y:this.drag.panY+dy}; this.draw(); return;
      }
      const hit = this.hitTest(this.worldPoint(event));
      this.hoverRoleId = hit.roleId || '';
      this.hoverBuildingId = hit.buildingId || '';
      this.canvas.style.cursor = hit.roleId || hit.buildingId ? 'pointer' : 'grab';
      this.draw();
    }

    pointerUp(event) {
      const wasDrag=this.drag; this.drag=null;
      if (!wasDrag || wasDrag.moved) return;
      const hit=this.hitTest(this.worldPoint(event));
      if (hit.roleId && this.options.onAgent) this.options.onAgent(hit.roleId);
      else if (hit.buildingId && this.options.onBuilding) this.options.onBuilding(hit.buildingId);
    }

    hitTest(point) {
      const states = this.simulation.snapshot().slice().reverse();
      for (const state of states) {
        const role = (this.assets.roles || []).find(row => row.roleId === state.roleId);
        if (!role) continue;
        const height=role.displayHeight||64,width=height*((role.frames.idle||{}).width||100)/((role.frames.idle||{}).height||180);
        if (point.x>=state.x-width/2 && point.x<=state.x+width/2 && point.y>=state.y-height && point.y<=state.y+6) return {roleId:state.roleId};
      }
      const building=(this.layout.buildings||[]).find(row=>this.layout.pointInRect(point,row.rect));
      return building?{buildingId:building.id}:{};
    }

    draw() {
      const ctx=this.ctx,view=this.transform(),dpr=view.dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle='#09111c'; ctx.fillRect(0,0,view.width,view.height);
      ctx.save(); ctx.translate(view.tx,view.ty); ctx.scale(view.scale,view.scale);
      ctx.imageSmoothingEnabled=false;
      const map=this.images.get('map'); if (map) ctx.drawImage(map,0,0,this.layout.map.width,this.layout.map.height);

      if (this.hoverBuildingId) {
        const building=this.layout.buildingById[this.hoverBuildingId];
        if (building) {
          ctx.fillStyle='rgba(99,189,222,.16)'; ctx.strokeStyle='rgba(143,220,247,.92)'; ctx.lineWidth=3/view.scale;
          ctx.fillRect(building.rect.x,building.rect.y,building.rect.w,building.rect.h);
          ctx.strokeRect(building.rect.x,building.rect.y,building.rect.w,building.rect.h);
        }
      }

      for (const state of this.simulation.snapshot()) this.drawAgent(ctx,state,view.scale);
      ctx.restore();
    }

    drawAgent(ctx, state, scale) {
      const roleAsset=(this.assets.roles||[]).find(row=>row.roleId===state.roleId);
      if (!roleAsset) return;
      const frame=roleAsset.frames[state.frameId]||roleAsset.frames.idle;
      const node=this.images.get(state.roleId+':'+state.frameId)||this.images.get(state.roleId+':idle');
      if (!node) return;
      const height=roleAsset.displayHeight||64,width=height*frame.width/frame.height;
      const anchorX=width*(frame.anchor.x/frame.width),anchorY=height*(frame.anchor.y/frame.height);
      const bob=Number(state.walkBob||0);
      ctx.drawImage(node,state.x-anchorX,state.y-anchorY+bob,width,height);

      const agent=state.agent||{},status=STATUS[agent.activity]||STATUS.idle;
      const selected=this.selectedRoleId===state.roleId,hover=this.hoverRoleId===state.roleId;
      if (selected||hover||agent.activity!=='idle') {
        const bx=state.x+width*.3,by=state.y-height+5,r=8;
        ctx.fillStyle='#07101b'; ctx.beginPath();ctx.arc(bx,by,r+2,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=status.color;ctx.beginPath();ctx.arc(bx,by,r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#08111b';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(status.symbol,bx,by+.5);
      }
      if (selected||hover) {
        const label='@'+String(agent.at||state.roleId);
        ctx.font='bold 11px system-ui'; const pad=5,textWidth=ctx.measureText(label).width;
        const x=state.x-textWidth/2-pad,y=state.y+4;
        roundedRect(ctx,x,y,textWidth+pad*2,20,5);ctx.fillStyle='rgba(7,16,27,.92)';ctx.fill();
        ctx.fillStyle='#f5f7fb';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,state.x,y+10);
      }

      const bubble = agent.activity==='talk' ? agent.lastMessage : (agent.activity==='blocked' ? agent.statusText : '');
      if ((selected||agent.activity==='talk'||agent.activity==='blocked') && bubble) this.drawBubble(ctx,state.x,state.y-height-8,String(bubble),scale);
    }

    drawBubble(ctx,x,y,text,scale) {
      const clean=text.replace(/\s+/g,' ').trim().slice(0,150);
      if (!clean) return;
      ctx.font='11px system-ui';
      const maxWidth=215,words=clean.split(' '),lines=[];let line='';
      for (const word of words) {
        const next=line?line+' '+word:word;
        if (ctx.measureText(next).width>maxWidth && line){lines.push(line);line=word;}else line=next;
        if(lines.length===3) break;
      }
      if(line&&lines.length<3) lines.push(line);
      const shown=lines.join(' '); if(shown.length<clean.length&&lines.length) lines[lines.length-1]=lines[lines.length-1].replace(/[.,;:]?$/,'…');
      const width=Math.min(maxWidth,Math.max(78,...lines.map(row=>ctx.measureText(row).width)))+16;
      const height=lines.length*15+14,bx=x-width/2,by=y-height;
      roundedRect(ctx,bx,by,width,height,7);ctx.fillStyle='rgba(7,16,27,.94)';ctx.fill();
      ctx.strokeStyle='rgba(218,226,237,.55)';ctx.lineWidth=1/scale;ctx.stroke();
      ctx.fillStyle='#eef2f7';ctx.textAlign='left';ctx.textBaseline='top';
      lines.forEach((row,index)=>ctx.fillText(row,bx+8,by+7+index*15));
    }
  }

  root.StudioTownRenderer = Object.freeze({ TownRenderer, STATUS });
})(globalThis);
