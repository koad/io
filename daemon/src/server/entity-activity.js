// server/entity-activity.js — the daemon side of the activity contract.
//
// WHY THIS EXISTS. mcp.koad.sh's session tracker has been calling
// `entities.activity` on the daemon for every tool call since 2026-11-05
// (`src/server/sessions/tracker.js`). The method did not exist, so the call failed
// soft and logged once: a live call to a nonexistent method is a lie in the code,
// and a caller that fails soft leaves no trace anywhere a human looks. This is the
// method — small on purpose.
//
// WHAT A CALL MEANS. `{ entity, kind, tool, ok, at, sessionId }` — one thing
// happened, for one entity. The daemon moves that entity's `lastActivity` forward
// and its `activity` counters (total calls, last kind/tool/time, per-tool counts) in
// `koad.library.entities`, so her profile and the kingdom's activity timers are
// honest without every surface keeping its own copy.
//
// WHAT IT IS NOT. Not a log: the records live on disk at mcp.koad.sh and are indexed
// by control-tower. This method carries NO body, NO arguments and NO summary — a
// caller that sends prose would be storing it here for no reason. Unknown keys are
// dropped.
//
// MONOTONIC `lastActivity`. The scanner treats a committed baseline as a floor and
// refuses to regress a live stamp; this method must do the same, or a delayed push
// would move the entity backwards in time. Counters are in-memory (the daemon is
// `MONGO_URL=false` by design), so a restart resets them — that is a projection
// resetting, not a fact changing, and `lastActivity` is rebuilt from disk by the
// scanner.

const KNOWN_KINDS = { tool: 1, session: 1, turn: 1, emission: 1 };

// A tool name becomes a Mongo field path (`activity.byTool.<name>`), so it must be
// an identifier. Anything else is counted in the total and not broken out.
const TOOL_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function asDate(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

Meteor.methods({
  /**
   * entities.activity(record)
   *
   * Idempotent in the direction that matters: `lastActivity` only moves forward.
   * Returns a receipt; an unknown entity is a refusal with a reason, not an
   * exception, because the caller pushes on every tool call and a throw would be
   * one error line per call for a condition nothing can fix at the sender.
   */
  'entities.activity'(record) {
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'record must be an object' };
    }

    const entity = typeof record.entity === 'string' ? record.entity.trim() : '';
    if (!entity) return { ok: false, reason: 'entity is required' };

    const doc = koad.library.entities.findOne({ handle: entity });
    if (!doc) return { ok: false, reason: 'unknown entity', entity };

    const at = asDate(record.at);
    const kind = KNOWN_KINDS[record.kind] ? record.kind : 'tool';
    const tool = typeof record.tool === 'string' ? record.tool.slice(0, 64) : '';
    const ok = record.ok !== false;

    const set = {};
    // Both stamps are monotonic. A push that arrives late carries an older `at`;
    // labelling it "the last thing that happened" would move the entity backwards
    // in time. The COUNTER still increments — a call arrived, which is true.
    const prevAtRaw = doc.activity && doc.activity.lastAt ? new Date(doc.activity.lastAt) : null;
    const prevAt = prevAtRaw && !isNaN(prevAtRaw.getTime()) ? prevAtRaw : null;
    if (!prevAt || at >= prevAt) {
      set['activity.lastAt'] = at;
      set['activity.lastKind'] = kind;
      if (tool) set['activity.lastTool'] = tool;
    }

    // Never regress the live stamp the scanner may also be writing.
    const current = doc.lastActivity ? new Date(doc.lastActivity) : null;
    if (!current || isNaN(current.getTime()) || at > current) set.lastActivity = at;

    const inc = { 'activity.toolCalls': 1 };
    if (kind === 'tool' && TOOL_RE.test(tool)) inc[`activity.byTool.${tool}`] = 1;

    try {
      const modifier = { $inc: inc };
      if (Object.keys(set).length) modifier.$set = set;
      koad.library.entities.update({ _id: doc._id }, modifier);
    } catch (err) {
      // In-memory collection — a failure here is a bug, not a load condition.
      return { ok: false, reason: err && err.message ? err.message : 'update failed', entity };
    }

    return {
      ok: true,
      entity,
      at: at.toISOString(),
      kind,
      tool: tool || null,
      // The receipt says which branch the caller's `ok` landed in, so a tracker
      // that ever wants to show failures does not have to remember it.
      callOk: ok,
    };
  },
});
