// Conversation Thread Model — VESTA-SPEC-143
// Materializes a Conversations collection from HarnessSessions records.
//
// A conversation groups all HarnessSessions sharing the same Claude Code session_id.
// When a harness resumes with -c, it inherits the same session_id — a new PID,
// a new HarnessSessions record, but the same conversation thread.
//
// For opencode sessions (sessionId: null), each HarnessSessions record is its own
// conversation (1:1 mapping keyed by session._id).
//
// The materializer is idempotent and is triggered from upsertSession() in session-scanner.js.

const Conversations = new Mongo.Collection('Conversations', { connection: null });

globalThis.ConversationsCollection = Conversations;

// ---------------------------------------------------------------------------
// Core materializer
// ---------------------------------------------------------------------------
//
// Rebuilds a single conversation thread from all HarnessSessions records that
// share sessionIdOrFallback. For claude-code sessions, sessionIdOrFallback is
// the Claude Code session UUID. For opencode sessions, it is the session._id.
//
// Idempotent — safe to call on every upsertSession write.
function rebuildConversationForSession(entity, sessionIdOrFallback) {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions || !entity || !sessionIdOrFallback) return;

  // Find all sessions matching this thread key.
  // claude-code: sessions.sessionId === key
  // opencode: sessions._id === key (sessionId is null)
  let sessions = Sessions.find({ entity, sessionId: sessionIdOrFallback }, {
    sort: { startedAt: 1 },
  }).fetch();

  // If no claude-code match, try opencode fallback (_id match, sessionId null)
  if (sessions.length === 0) {
    const single = Sessions.findOne({ _id: sessionIdOrFallback, entity });
    if (single) sessions = [single];
  }

  if (sessions.length === 0) {
    // Orphaned ref — the session may have been archived. No-op.
    return;
  }

  // Aggregate fields
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let firstStartedAt = null;
  let lastSeen = null;
  let status = 'dormant';
  let model = '';
  let modelId = '';
  let host = '';
  let cwd = '';
  let harness = '';

  const sessionRefs = [];

  for (const s of sessions) {
    totalCost += s.cost || 0;
    totalTokensIn += s.tokensIn || 0;
    totalTokensOut += s.tokensOut || 0;

    const sStartedAt = s.startedAt ? new Date(s.startedAt) : null;
    const sLastSeen = s.lastSeen ? new Date(s.lastSeen) : null;

    if (sStartedAt) {
      if (!firstStartedAt || sStartedAt < firstStartedAt) firstStartedAt = sStartedAt;
    }
    if (sLastSeen) {
      if (!lastSeen || sLastSeen > lastSeen) lastSeen = sLastSeen;
    }

    if (s.status === 'active') status = 'active';

    // Last-writer wins for descriptive fields
    if (s.model) model = s.model;
    if (s.modelId) modelId = s.modelId;
    if (s.host) host = s.host;
    if (s.cwd) cwd = s.cwd;
    if (s.harness) harness = s.harness;

    sessionRefs.push({
      _id: s._id,
      pid: s.pid || null,
      startedAt: s.startedAt || null,
      endedAt: s.endedAt || null,
      cost: s.cost || 0,
    });
  }

  const totalDurationMs = (firstStartedAt && lastSeen)
    ? lastSeen.getTime() - firstStartedAt.getTime()
    : 0;

  const now = new Date();
  const doc = {
    entity,
    host,
    cwd,
    harness,
    status,
    sessionCount: sessions.length,
    totalCost,
    totalDurationMs,
    totalTokensIn,
    totalTokensOut,
    firstStartedAt: firstStartedAt || now,
    lastSeen: lastSeen || now,
    model,
    modelId,
    sessions: sessionRefs,
    updatedAt: now,
  };

  const existing = Conversations.findOne({ _id: sessionIdOrFallback });
  if (existing) {
    Conversations.update({ _id: sessionIdOrFallback }, { $set: doc });
  } else {
    Conversations.insert(Object.assign({ _id: sessionIdOrFallback }, doc));
  }
}

// ---------------------------------------------------------------------------
// Startup full rebuild
// ---------------------------------------------------------------------------
//
// Called once on daemon startup after scanAll() completes. Derives every
// conversation thread from the current HarnessSessions state.
function rebuildAllConversations() {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const allSessions = Sessions.find({}).fetch();

  // Collect distinct sessionId values (claude-code threads)
  const threadKeys = new Map(); // key → entity
  const opencodeSessionIds = [];

  for (const s of allSessions) {
    if (s.sessionId) {
      // claude-code thread — key is the stable session UUID
      threadKeys.set(s.sessionId, s.entity);
    } else {
      // opencode session — each is its own thread keyed by _id
      opencodeSessionIds.push({ _id: s._id, entity: s.entity });
    }
  }

  let rebuilt = 0;

  for (const [sessionId, entity] of threadKeys) {
    rebuildConversationForSession(entity, sessionId);
    rebuilt++;
  }

  for (const { _id, entity } of opencodeSessionIds) {
    rebuildConversationForSession(entity, _id);
    rebuilt++;
  }

  const active = Conversations.find({ status: 'active' }).count();
  const dormant = Conversations.find({ status: 'dormant' }).count();
  console.log(`[CONVERSATIONS] Rebuilt ${rebuilt} threads (${active} active, ${dormant} dormant)`);
}

// ---------------------------------------------------------------------------
// Exports via globalThis
// ---------------------------------------------------------------------------
globalThis.ConversationMaterializer = {
  rebuild: rebuildConversationForSession,
  rebuildAll: rebuildAllConversations,
};

// ---------------------------------------------------------------------------
// DDP Publications
// ---------------------------------------------------------------------------
Meteor.publish('conversations.active', function () {
  return Conversations.find({ status: 'active' });
});

Meteor.publish('conversations.entity', function (entity) {
  check(entity, String);
  return Conversations.find({ entity });
});
