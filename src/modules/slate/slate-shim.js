/* ============================================================
   window.slate — Slate's Electron preload API, reimplemented for the
   Studio shell.

   Slate's renderer is used verbatim; only the privileged bridge changes.
   In the real app `contextBridge.exposeInMainWorld('slate', api)` wired
   these to ipcRenderer. Here they run against WebKit localStorage and
   the local model server directly, so nothing about the UI has to know
   it moved. Contract: src/shared/types.ts → SlateApi.

   Capabilities that genuinely needed a Node host — file dialogs, ffmpeg
   frame extraction, audio fingerprinting — resolve empty rather than
   throwing, so the app degrades instead of white-screening. Those are
   listed in ARCHITECTURE.md as not yet ported.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'studio.slate.projects.v1';
  var uuid = function () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  };

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeAll(m) {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }

  /* Slate's own factory, copied from src/main/projects.ts so a project
     created here is byte-compatible with one created by the real app. */
  function newProject(name) {
    var now = new Date().toISOString();
    return {
      id: uuid(), name: name, logline: '', world: '',
      defaults: { aspectRatio: '16:9', fps: 24, durationSec: 8, targetModel: 'seedance-2', brain: 'local' },
      scenes: [], characters: [], artDept: [], locations: [], lookbook: [],
      references: [], mySetups: [], music: [], voices: [],
      createdAt: now, updatedAt: now
    };
  }

  var listeners = { projects: [], help: [], about: [] };
  function fire(kind) { (listeners[kind] || []).forEach(function (cb) { try { cb(); } catch (e) {} }); }
  function subscribe(kind, cb) {
    listeners[kind].push(cb);
    return function () { listeners[kind] = listeners[kind].filter(function (x) { return x !== cb; }); };
  }

  /* ---------- local model server (same detection the shell uses) ---------- */
  var CANDIDATES = ['http://127.0.0.1:11434', 'http://127.0.0.1:1234', 'http://127.0.0.1:8080', 'http://127.0.0.1:8000'];
  var cachedEndpoint = null;

  function baseOf(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^\d+$/.test(u)) u = 'http://127.0.0.1:' + u;
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u.replace(/\/+$/, '').replace(/\/(v1|api)(\/.*)?$/i, '').replace(/\/+$/, '');
  }

  function getJson(url, ms) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms || 2500);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) { clearTimeout(t); return r.ok ? r.json() : null; })
      .catch(function () { clearTimeout(t); return null; });
  }

  function detectLocal(preferred) {
    var list = [];
    [baseOf(preferred), cachedEndpoint].concat(CANDIDATES).forEach(function (b) {
      if (b && list.indexOf(b) === -1) list.push(b);
    });
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve({ endpoint: null, models: [] });
      var base = list[i++];
      return getJson(base + '/api/tags').then(function (tags) {
        if (tags && Array.isArray(tags.models)) {
          cachedEndpoint = base;
          return { endpoint: base, models: tags.models.map(function (m) { return { id: m.name || m.model }; }).filter(function (x) { return x.id; }) };
        }
        return getJson(base + '/v1/models').then(function (v1) {
          if (v1 && Array.isArray(v1.data)) {
            cachedEndpoint = base;
            return { endpoint: base, models: v1.data.map(function (m) { return { id: String(m.id) }; }) };
          }
          return next();
        });
      });
    }
    return next();
  }

  var running = {};

  function brainRun(req) {
    var started = Date.now();
    return detectLocal(req && req.localEndpoint).then(function (hit) {
      if (!hit.endpoint) {
        return { id: req.id, ok: false, text: '', error: 'No local model server is running. Start Ollama and try again.', elapsedMs: Date.now() - started };
      }
      var model = (req && req.localModel) || (hit.models[0] && hit.models[0].id);
      if (!model) {
        return { id: req.id, ok: false, text: '', error: 'No model installed on ' + hit.endpoint, elapsedMs: Date.now() - started };
      }
      var ctrl = new AbortController();
      running[req.id] = ctrl;
      var body = {
        model: model,
        messages: [{ role: 'system', content: req.system || '' }, { role: 'user', content: req.prompt || '' }],
        stream: false,
        options: { temperature: 0.4, num_ctx: 16384 }
      };
      if (req.expectJson) body.format = 'json';
      return fetch(hit.endpoint + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (d) { throw new Error('Model server returned ' + r.status + (d ? ' — ' + d.slice(0, 200) : '')); });
        return r.json();
      }).then(function (j) {
        delete running[req.id];
        var text = (j.message && j.message.content) || '';
        // Reasoning models leave a think block in content on some builds.
        text = text.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '').trim();
        var out = { id: req.id, ok: true, text: text, elapsedMs: Date.now() - started };
        if (req.expectJson) {
          try { out.json = JSON.parse(text); }
          catch (e) {
            var a = text.indexOf('{'), b = text.lastIndexOf('}');
            if (a >= 0 && b > a) { try { out.json = JSON.parse(text.slice(a, b + 1)); } catch (e2) {} }
          }
        }
        return out;
      }).catch(function (err) {
        delete running[req.id];
        var msg = ctrl.signal.aborted ? 'Cancelled' : (err && err.message) || String(err);
        return { id: req.id, ok: false, text: '', error: msg, elapsedMs: Date.now() - started };
      });
    });
  }

  var api = {
    listProjects: function () {
      var all = readAll();
      var metas = Object.keys(all).map(function (id) {
        var p = all[id];
        var shots = (p.scenes || []).reduce(function (n, s) { return n + ((s.shots || []).length); }, 0);
        return {
          id: p.id, name: p.name, logline: p.logline || '',
          path: 'studio://slate/' + p.id, updatedAt: p.updatedAt,
          sceneCount: (p.scenes || []).length, shotCount: shots
        };
      });
      metas.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
      return Promise.resolve(metas);
    },
    createProject: function (name) {
      var all = readAll();
      var p = newProject(name);
      all[p.id] = p; writeAll(all); fire('projects');
      return Promise.resolve(p);
    },
    openProject: function (id) { return Promise.resolve(readAll()[id] || null); },
    saveProject: function (project) {
      var all = readAll();
      project.updatedAt = new Date().toISOString();
      all[project.id] = project; writeAll(all); fire('projects');
      return Promise.resolve();
    },
    deleteProject: function (id) {
      var all = readAll(); delete all[id]; writeAll(all); fire('projects');
      return Promise.resolve();
    },
    revealProject: function () { return Promise.resolve(); },

    brainStatus: function (localEndpoint) {
      return detectLocal(localEndpoint).then(function (hit) {
        return {
          claude: { available: false, version: null },
          codex: { available: false, version: null },
          local: { available: !!hit.endpoint, version: hit.models.length ? hit.models[0].id : null, endpoint: hit.endpoint }
        };
      });
    },
    localModels: function (endpoint) { return detectLocal(endpoint); },
    brainRun: brainRun,
    brainRunWith: function (req) { return brainRun(req); },
    brainCancel: function (id) {
      if (running[id]) { try { running[id].abort(); } catch (e) {} delete running[id]; }
      return Promise.resolve();
    },
    brainTest: function (backend, local) {
      return brainRun({
        id: 'test-' + Date.now(), task: 'self-test',
        system: 'You are a connectivity check. Reply with exactly one word.',
        prompt: 'Reply with exactly: READY', tier: 'fast',
        localEndpoint: local && local.endpoint, localModel: local && local.model
      });
    },

    // Needed a Node host in Electron; not ported yet. Resolve empty so the
    // UI shows "nothing found" instead of throwing.
    pickMedia: function () { return Promise.resolve([]); },
    pickAudio: function () { return Promise.resolve([]); },
    ingestMedia: function () { return Promise.resolve({ kind: 'image', frames: [] }); },
    stillsDiscover: function () { return Promise.resolve([]); },
    stillsExtract: function () { return Promise.resolve([]); },
    analyzeAudio: function () { return Promise.resolve(null); },
    pathForFile: function (file) { return (file && file.name) || ''; },

    copyText: function (text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text));
      } catch (e) {}
      var ta = document.createElement('textarea');
      ta.value = String(text); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
      return Promise.resolve();
    },

    onProjectsChanged: function (cb) { return subscribe('projects', cb); },
    onHelpOpen: function (cb) { return subscribe('help', cb); },
    onAboutOpen: function (cb) { return subscribe('about', cb); }
  };

  window.slate = api;
})();
