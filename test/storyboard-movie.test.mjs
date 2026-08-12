import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

function bodyBetween(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source span ${start} -> ${end}`);
  return source.slice(a, b);
}

function loadBoardFunctions(context) {
  vm.createContext(context);
  const block = bodyBetween('function boardFindShot', '/* ---------- AI on a card ---------- */');
  vm.runInContext(`${block}\nglobalThis.__queue = boardQueueVideo; globalThis.__refresh = boardRefreshVideos;`, context, {
    filename: 'storyboard-video.js'
  });
  return { queue: context.__queue, refresh: context.__refresh };
}

function boardContext(shot) {
  return {
    console, Promise, Set, Map, Date, Math, Number, String, JSON,
    setTimeout: () => 1,
    clearTimeout: () => {},
    ACTIVE: { p: 'project-1', d: 'draft-1' },
    BOARD: { batchPromise: null, queueing: new Set(), pollPromise: null, pollTimer: null, pollOwner: '' },
    S: { title: 'Film' },
    PL: { seconds: 5 },
    CREW_UNPROVEN_CODE: 'PHOSPHENE_SUBMISSION_UNPROVEN',
    allShotsB: () => [{ sc: { num: 1 }, sh: shot }],
    boardOf: item => item.board,
    boardEditingLocked: () => false,
    boardDraftOwner: () => 'project-1|draft-1',
    boardDraftOwnerMatches: owner => owner === 'project-1|draft-1',
    boardActiveVideoJobs: () => shot.board.video?.id && ['queued', 'running'].includes(shot.board.video.status)
      ? [{ sh: shot, job: shot.board.video }]
      : [],
    productionState: () => null,
    crewMutationLocked: () => false,
    crewCanonicalLocked: () => false,
    activeView: () => 'shots',
    renderBoards: async () => {},
    persistNow: () => true,
    pdFrameDataUrl: async () => 'data:image/png;base64,FRAME',
    crewEnsureServices: async () => ({ pitchdeck: { ok: true } }),
    crewJobId: row => row?.id || row?.job?.id,
    crewStatusRows: data => data.jobs || [],
    crewMediaUrl: (id, providerId = 'phosphene') => `http://127.0.0.1:5179/api/video/providers/${providerId}/jobs/${id}/media`,
    videoProviderSelection: () => ({ id: 'phosphene', model: '', billingApproved: false }),
    videoProviderDescriptor: id => ({ id, name: 'Phosphene', configured: true, requiresBillingApproval: false }),
    videoReviewEnvelope: () => ({ schema: 'studio/video-review@1', gate: 'approved', reasons: [] }),
    videoBillingApproval: selection => ({ approved: selection.billingApproved === true, providerId: selection.id }),
    crewSubmissionUnproven: job => job?.code === 'PHOSPHENE_SUBMISSION_UNPROVEN',
    uid: () => 'render-uid',
    toast: () => {},
    openModal: () => {},
    closeModal: () => {},
    addTake: (id, take) => { assert.equal(id, shot.id); shot.takes.push({ id: 'take-1', ...take }); }
  };
}

test('Storyboard Movie keeps PitchDeck photo-to-video on the canonical shot card', () => {
  assert.match(source, /<h2>Storyboard Movie<\/h2>/);
  assert.match(source, /id="btnBoardRenderAll"/);
  const render = bodyBetween('async function renderBoards', 'function boardDetail');
  assert.match(render, /<video controls playsinline/);
  assert.match(render, /data-bvideo/);
  assert.match(render, /boardVideoStatus\(sh\)/);
  const queue = bodyBetween('async function boardQueueVideoOnce', 'async function boardAuthorizeFreshRender');
  assert.match(queue, /imageDataUrl/);
  assert.match(queue, /queue-batch/);
  assert.match(queue, /studioShotId:sh\.id/);
  assert.match(queue, /boardStoreVideo\(sh,admitting\)/);
  assert.doesNotMatch(queue, /addTake\s*\(/);
});

test('a storyboard still is sent once and a queue receipt is not presented as a finished clip', async () => {
  const shot = {
    id: 'shot-1', num: 1,
    prompt: { text: 'The camera tracks toward the open door.', seconds: 5 },
    board: { frame: 'frame-1', video: null, fields: {} },
    takes: []
  };
  const context = boardContext(shot);
  let request;
  context.crewFetchJson = async (path, options) => {
    request = { path, body: JSON.parse(options.body) };
    return { ok: true, jobs: [{ studioShotId: shot.id, id: 'job-1', reused: false }] };
  };
  const { queue } = loadBoardFunctions(context);
  assert.equal(await queue(shot.id), true);
  assert.equal(request.path, '/api/video/queue-batch');
  assert.equal(request.body.providerId, 'phosphene');
  assert.equal(request.body.shots[0].studioShotId, shot.id);
  assert.equal(request.body.shots[0].imageDataUrl, 'data:image/png;base64,FRAME');
  assert.equal(shot.board.video.id, 'job-1');
  assert.equal(shot.board.video.status, 'queued');
  assert.equal(shot.takes.length, 0, 'acceptance is not a finished video');
});

test('provider completion returns to the exact storyboard card as a playable take', async () => {
  const shot = {
    id: 'shot-1', num: 1,
    prompt: { text: 'A locked prompt.' },
    board: { frame: 'frame-1', fields: {}, video: { runId: 'board-run', attempt: 0, id: 'job-1', status: 'queued' } },
    takes: []
  };
  const context = boardContext(shot);
  context.crewFetchJson = async () => ({
    ok: true,
    jobs: [{ id: 'job-1', status: 'done', outputPath: '/tmp/shot-1.mp4' }],
    missingIds: []
  });
  const { refresh } = loadBoardFunctions(context);
  const result = await refresh();
  assert.equal(result.done, 1);
  assert.equal(shot.board.video.status, 'done');
  assert.equal(shot.takes.length, 1);
  assert.equal(shot.takes[0].jobId, 'job-1');
  assert.equal(shot.takes[0].file, 'http://127.0.0.1:5179/api/video/providers/phosphene/jobs/job-1/media');
});
