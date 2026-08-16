(function (root) {
  'use strict';

  const TRAVEL_TYPES = new Set(['handoff', 'request', 'rework']);

  function copyPoint(point) {
    return { x:Number(point.x || 0), y:Number(point.y || 0) };
  }

  function distance(a, b) {
    return Math.hypot(Number(b.x || 0) - Number(a.x || 0), Number(b.y || 0) - Number(a.y || 0));
  }

  function routeFromPosition(position, route) {
    const points = (route || []).map(copyPoint);
    if (!points.length) return [copyPoint(position)];
    points[0] = copyPoint(position);
    return points;
  }

  class TownSimulation {
    constructor(layout, options) {
      if (!layout) throw new Error('Studio Town simulation requires a layout.');
      this.layout = layout;
      this.options = Object.assign({ speed:210, reducedMotion:false }, options || {});
      this.states = new Map();
      this.vm = null;
      this.initialized = false;
      this.lastEventId = '';
      this.ownerKey = '';
      this.nowMs = 0;
    }

    ensureAgent(agent) {
      let state = this.states.get(agent.roleId);
      if (!state) {
        const home = this.layout.roleHome(agent.roleId);
        state = {
          roleId:agent.roleId,
          x:home.x, y:home.y,
          route:[], routeIndex:0,
          moving:false,
          frameId:'idle',
          destinationBuildingId:agent.buildingId || home.buildingId,
          transientEventId:''
        };
        this.states.set(agent.roleId, state);
      }
      return state;
    }

    destinationFor(agent) {
      const building = this.layout.buildingById[agent.buildingId] || this.layout.buildingForRole(agent.roleId);
      if (agent.buildingId === agent.homeBuildingId) return this.layout.roleHome(agent.roleId);
      const roles = (this.vm && this.vm.agents || []).filter(row => row.buildingId === building.id);
      const index = Math.max(0, roles.findIndex(row => row.roleId === agent.roleId));
      const slot = building.slots[index] || building.slots[building.slots.length - 1] || building.door;
      return { x:slot.x, y:slot.y, buildingId:building.id };
    }

    setRoute(state, route, eventId) {
      const points = routeFromPosition(state, route);
      state.route = points.slice(1);
      state.routeIndex = 0;
      state.moving = state.route.length > 0;
      state.transientEventId = String(eventId || '');
      if (this.options.reducedMotion && state.route.length) {
        const last = state.route[state.route.length - 1];
        state.x = last.x; state.y = last.y;
        state.route = []; state.routeIndex = 0; state.moving = false;
      }
    }

    update(vm, nowMs) {
      this.vm = vm || { agents:[], events:[] };
      this.nowMs = Number(nowMs || Date.now());
      const ownerKey = [this.vm.projectId || '', this.vm.draftId || '', this.vm.runId || ''].join(':');
      if (this.ownerKey && ownerKey !== this.ownerKey) {
        this.states.clear();
        this.initialized = false;
        this.lastEventId = '';
      }
      this.ownerKey = ownerKey;
      const agents = this.vm.agents || [];
      agents.forEach(agent => this.ensureAgent(agent));

      if (!this.initialized) {
        agents.forEach(agent => {
          const state = this.ensureAgent(agent);
          const target = this.destinationFor(agent);
          state.x = target.x; state.y = target.y;
          state.destinationBuildingId = agent.buildingId;
        });
        const latest = (this.vm.events || [])[this.vm.events.length - 1];
        this.lastEventId = latest ? latest.id : '';
        this.initialized = true;
        return this.snapshot();
      }

      agents.forEach(agent => {
        const state = this.ensureAgent(agent);
        if (state.destinationBuildingId !== agent.buildingId) {
          const target = this.destinationFor(agent);
          const currentBuilding = this.layout.buildingById[state.destinationBuildingId] || this.layout.buildingForRole(agent.roleId);
          const targetBuilding = this.layout.buildingById[agent.buildingId] || this.layout.buildingForRole(agent.roleId);
          const route = currentBuilding.id === targetBuilding.id
            ? [state, target]
            : [state, currentBuilding.door, this.layout.map.meetingPoint, targetBuilding.door, target];
          this.setRoute(state, route, `state:${agent.roleId}:${agent.buildingId}`);
          state.destinationBuildingId = agent.buildingId;
        }
      });

      const events = this.vm.events || [];
      const priorIndex = this.lastEventId ? events.findIndex(row => row.id === this.lastEventId) : -1;
      const fresh = priorIndex >= 0 ? events.slice(priorIndex + 1) : events;
      for (const row of fresh) {
        if (!TRAVEL_TYPES.has(row.type)) continue;
        const from = row.fromRoleId && this.states.get(row.fromRoleId);
        const toRoleId = (row.toRoleIds || []).find(roleId => this.states.has(roleId));
        if (!from || !toRoleId) continue;
        const target = this.states.get(toRoleId);
        const fromBuilding = this.layout.buildingForRole(row.fromRoleId);
        const toBuilding = this.layout.buildingForRole(toRoleId);
        const home = this.layout.roleHome(row.fromRoleId);
        this.setRoute(from, [from, fromBuilding.door, this.layout.map.meetingPoint, toBuilding.door, target,
          toBuilding.door, this.layout.map.meetingPoint, fromBuilding.door, home], row.id);
      }
      const latest = events[events.length - 1];
      if (latest) this.lastEventId = latest.id;
      return this.snapshot();
    }

    tick(deltaMs) {
      const seconds = Math.max(0, Math.min(0.08, Number(deltaMs || 0) / 1000));
      const speed = Math.max(20, Number(this.options.speed || 210));
      for (const state of this.states.values()) {
        if (!state.route.length) { state.moving = false; continue; }
        let remaining = speed * seconds;
        while (remaining > 0 && state.route.length) {
          const target = state.route[0];
          const d = distance(state, target);
          if (d <= remaining || d < 0.5) {
            state.x = target.x; state.y = target.y;
            state.route.shift(); remaining -= d;
          } else {
            const ratio = remaining / d;
            state.x += (target.x - state.x) * ratio;
            state.y += (target.y - state.y) * ratio;
            remaining = 0;
          }
        }
        state.moving = state.route.length > 0;
      }
      return this.snapshot();
    }

    snapshot() {
      const byRole = new Map((this.vm && this.vm.agents || []).map(agent => [agent.roleId, agent]));
      const phase = Math.floor(this.nowMs / 240) % 2;
      return [...this.states.values()].map(state => {
        const agent = byRole.get(state.roleId) || {};
        let frameId = 'idle';
        if (state.moving) frameId = phase ? 'walk_left' : 'walk_right';
        else if (agent.activity === 'talk' || agent.activity === 'work') frameId = 'talk';
        return Object.assign({}, state, { frameId, agent });
      }).sort((a, b) => a.y - b.y || a.x - b.x);
    }

    setReducedMotion(value) {
      this.options.reducedMotion = !!value;
      if (this.options.reducedMotion) {
        for (const state of this.states.values()) {
          if (!state.route.length) continue;
          const last = state.route[state.route.length - 1];
          state.x = last.x; state.y = last.y;
          state.route = []; state.moving = false;
        }
      }
    }
  }

  root.StudioTownSimulation = Object.freeze({ TownSimulation, distance, routeFromPosition });
})(globalThis);
