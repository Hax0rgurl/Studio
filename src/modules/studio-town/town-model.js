(function (root) {
  'use strict';

  const SCHEMA = 'agentic-movie-studio/studio-town-event@1';
  const TERMINAL = new Set(['done', 'skipped']);
  const REVIEW_VERDICTS = new Set(['revise', 'flag', 'kill']);

  function iso(value) {
    const text = String(value || '');
    return Number.isFinite(Date.parse(text)) ? text : '';
  }

  function effectiveRoleId(roleId) {
    return roleId === 'story_review' ? 'story_editor' : String(roleId || '');
  }

  function event(input) {
    return {
      schema: SCHEMA,
      id: String(input.id || ''),
      projectId: String(input.projectId || ''),
      runId: String(input.runId || ''),
      type: String(input.type || 'reply'),
      fromRoleId: String(input.fromRoleId || ''),
      toRoleIds: [...new Set((input.toRoleIds || []).map(effectiveRoleId).filter(Boolean))],
      taskId: String(input.taskId || ''),
      artifactRef: input.artifactRef || null,
      status: String(input.status || ''),
      causedByEventId: String(input.causedByEventId || ''),
      createdAt: iso(input.createdAt),
      acknowledgedAt: iso(input.acknowledgedAt),
      text: String(input.text || '')
    };
  }

  function deriveEvents(input) {
    const production = input.production || {};
    const projectId = input.projectId || '';
    const runId = production.id || '';
    const rows = [];

    for (const entry of input.transcript || []) {
      const roleId = effectiveRoleId(entry.roleId);
      const conversation = entry.kind === 'conversation';
      rows.push(event({
        id: entry.id || `message:${roleId || 'client'}:${entry.at || ''}`,
        projectId, runId,
        type: entry.kind === 'client' ? 'request' : (conversation ? entry.eventType : (entry.status === 'failed' ? 'blocker' : 'artifact')),
        fromRoleId: entry.kind === 'client' ? 'client' : (conversation ? entry.fromRoleId : roleId),
        toRoleIds: entry.kind === 'client' && entry.targetRoleId ? [entry.targetRoleId] : (conversation ? entry.toRoleIds : []),
        taskId: roleId,
        artifactRef: entry.artifact || null,
        status: entry.status || '',
        causedByEventId: entry.causedByEventId || '',
        createdAt: entry.at || '',
        acknowledgedAt: entry.acknowledgedAt || '',
        text: entry.text || ''
      }));
    }

    for (const decision of (production.orchestration && production.orchestration.decisions) || []) {
      rows.push(event({
        id: `handoff:${decision.at || ''}:${decision.nextRole || ''}`,
        projectId, runId, type:'handoff', fromRoleId:'producer', toRoleIds:[decision.nextRole],
        taskId:'producer', status:'acknowledged', createdAt:decision.at,
        text:decision.clientUpdate || decision.reason || ''
      }));
    }

    for (const item of production.reworkQueue || []) {
      const step = (production.steps || {})[item.roleId] || {};
      const requestedAt = Date.parse(item.requestedAt || '');
      const finishedAt = Date.parse(step.finishedAt || step.updatedAt || '');
      const inferredComplete = TERMINAL.has(step.status) && Number.isFinite(requestedAt)
        && Number.isFinite(finishedAt) && finishedAt >= requestedAt;
      const completedAt = item.completedAt || item.resolvedAt || (inferredComplete ? (step.finishedAt || step.updatedAt) : '');
      rows.push(event({
        id:item.id || `rework:${item.roleId}:${item.requestedAt || ''}`,
        projectId, runId, type:'rework', fromRoleId:'client', toRoleIds:[item.roleId],
        taskId:item.roleId, status:completedAt ? 'complete' : (item.preparedAt ? 'prepared' : 'requested'),
        acknowledgedAt:completedAt,
        createdAt:item.requestedAt,
        text:item.note || item.verdict || ''
      }));
    }

    for (const item of production.shotReworkQueue || []) {
      rows.push(event({
        id:item.id || `shot-rework:${item.shotId}:${item.requestedAt || ''}`,
        projectId, runId, type:'rework', fromRoleId:'client',
        toRoleIds:['prompt_writer','stills_prompt','stills','second_unit','editor'],
        taskId:item.shotId, status:item.completedAt ? 'complete' : (item.queuedAt ? 'queued' : 'requested'),
        createdAt:item.requestedAt, text:item.note || item.verdict || ''
      }));
    }

    return rows.filter(row => row.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function recent(createdAt, nowMs, windowMs) {
    const time = Date.parse(createdAt || '');
    return Number.isFinite(time) && nowMs >= time && nowMs - time <= windowMs;
  }

  function roleStep(production, roleId) {
    const steps = production.steps || {};
    if (roleId === 'story_editor' && effectiveRoleId(production.currentStep) === roleId && production.currentStep === 'story_review') {
      return steps.story_review || steps.story_editor || {};
    }
    return steps[roleId] || {};
  }

  function reviewIsOpen(step) {
    const review = step && step.review;
    if (!review || !REVIEW_VERDICTS.has(String(review.verdict || '').toLowerCase())) return false;
    if (review.resolvedAt) return false;
    const reviewedAt = Date.parse(review.at || '');
    const finishedAt = Date.parse(step.finishedAt || step.updatedAt || '');
    // Older productions did not mark department rework requests complete.
    // A later durable terminal artifact is nevertheless proof that the cited
    // review was handled; do not strand that agent in the screening room.
    return !(TERMINAL.has(step.status) && Number.isFinite(reviewedAt)
      && Number.isFinite(finishedAt) && finishedAt >= reviewedAt);
  }

  function deriveAgent(role, input, events) {
    const production = input.production || {};
    const nowMs = Number(input.nowMs || Date.now());
    const roleId = role.id;
    const step = roleStep(production, roleId);
    const currentRoleId = effectiveRoleId(production.currentStep);
    const current = currentRoleId === roleId;
    const latestMessage = [...(input.transcript || [])].reverse().find(entry => effectiveRoleId(entry.roleId) === roleId
      || effectiveRoleId(entry.fromRoleId) === roleId
      || (entry.toRoleIds || []).map(effectiveRoleId).includes(roleId));
    const latestEvent = [...events].reverse().find(row => row.fromRoleId === roleId || row.toRoleIds.includes(roleId));
    const review = step.review || null;
    const failed = step.status === 'failed' || (current && production.status === 'needs_attention');
    const media = input.media || {};
    const mediaWorking = (roleId === 'stills' && Number(media.imageRunning || 0) > 0)
      || (roleId === 'second_unit' && Number(media.videoRunning || 0) > 0)
      || (roleId === 'editor' && media.assembling === true);
    const working = !failed && (current || input.busyAt === role.at || step.status === 'running' || mediaWorking);
    const waitingReview = !failed && reviewIsOpen(step);
    const talking = !failed && !working && !waitingReview && latestMessage && recent(latestMessage.at, nowMs, 15000);
    const complete = !failed && !working && !waitingReview && TERMINAL.has(step.status);

    let activity = 'idle';
    if (failed) activity = 'blocked';
    else if (waitingReview) activity = 'review';
    else if (working) activity = 'work';
    else if (talking) activity = 'talk';
    else if (complete) activity = 'complete';

    const homeBuildingId = input.layout.roleBuildings[roleId] || 'production';
    const buildingId = activity === 'review' ? 'screening' : homeBuildingId;
    const live = input.live && effectiveRoleId(input.live.roleId) === roleId ? input.live : null;
    let statusText = '';
    if (activity === 'blocked') statusText = String(step.error || step.out || production.error || 'A durable blocker is recorded for this department.');
    else if (activity === 'review') statusText = String(review.note || 'A human rework decision is recorded for this artifact.');
    else if (activity === 'work') statusText = String((live && live.text) || step.out || 'The task is claimed; no checkpointed artifact exists yet.');
    else if (activity === 'talk') statusText = String(latestMessage.text || '');
    else if (activity === 'complete') statusText = String(step.out || 'The artifact and checkpoint are durable.');
    else statusText = 'No claimed work.';

    const provider = roleId === 'stills' ? input.imageProvider
      : (roleId === 'second_unit' || roleId === 'editor' ? input.videoProvider : null);

    return {
      roleId,
      at: role.at,
      title: role.title,
      department: role.dept,
      module: role.mod,
      job: role.job,
      owns: role.owns,
      activity,
      current,
      homeBuildingId,
      buildingId,
      status: String(step.status || 'waiting'),
      statusText,
      taskId: current ? String(production.currentStep || roleId) : roleId,
      artifact: step.artifact || null,
      review,
      provider: provider || null,
      startedAt: iso(step.startedAt),
      updatedAt: iso(step.updatedAt || step.finishedAt),
      lastMessage: latestMessage ? String(latestMessage.text || '') : '',
      lastMessageAt: latestMessage ? iso(latestMessage.at) : '',
      lastEventId: latestEvent ? latestEvent.id : '',
      canRun: input.allowManual === true
    };
  }

  function deriveTownVM(input) {
    if (!input || !input.layout) throw new Error('Studio Town requires the canonical layout.');
    const production = input.production || null;
    const events = deriveEvents(input);
    const agents = (input.roster || []).map(role => deriveAgent(role, input, events));
    const finished = agents.filter(agent => agent.activity === 'complete').length;
    const serviceRows = Object.entries(input.services || {}).map(([id, row]) => ({
      id,
      name: String((row && row.name) || id),
      ok: !!(row && row.ok),
      detail: String((row && (row.detail || row.status)) || '')
    }));
    return {
      schema: 'agentic-movie-studio/studio-town-view@1',
      projectId: String(input.projectId || ''),
      draftId: String(input.draftId || ''),
      runId: String((production && production.id) || ''),
      title: String(input.title || 'Untitled'),
      productionStatus: String((production && production.status) || 'idle'),
      productionError: String((production && production.error) || ''),
      currentRoleId: effectiveRoleId(production && production.currentStep),
      selectedRoleId: String(input.selectedRoleId || ''),
      finished,
      total: agents.length,
      clipProgress: Object.assign({done:0,failed:0,total:0}, (production && production.renderProgress) || {}),
      agents,
      buildings: input.layout.buildings,
      events,
      services: serviceRows,
      latestEvent: events[events.length - 1] || null,
      hasProduction: !!production
    };
  }

  root.StudioTownModel = Object.freeze({ SCHEMA, effectiveRoleId, reviewIsOpen, deriveEvents, deriveTownVM });
})(globalThis);
