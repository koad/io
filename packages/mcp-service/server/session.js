// session.js — MCP session manager
// Tracks active MCP sessions: { sessionId → { profile, sseRes, notificationBuf } }
// Provides fanout for notifications to active sessions.
//
// VESTA-SPEC-139 §7

'use strict';

const crypto = require('crypto');

// Active sessions map: sessionId → session record
// session record: { sessionId, profile, sseRes, createdAt, lastActivity }
const sessions = new Map();

function generateSessionId() {
  return 'mcp-' + crypto.randomBytes(16).toString('hex');
}

// Create a new MCP session for an authenticated profile.
// Returns the session ID.
function createSession(profile) {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    sessionId,
    profile,
    sseRes: null,       // set when SSE stream connects
    createdAt: new Date(),
    lastActivity: new Date(),
  });
  console.log(`[mcp-service:session] opened session=${sessionId} entity=${profile.entity} bond=${profile.bond_type}`);
  return sessionId;
}

// Attach an SSE response stream to an existing session.
function attachSSE(sessionId, sseRes) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.sseRes = sseRes;
  session.lastActivity = new Date();
  return true;
}

// Retrieve a session by ID (returns null if not found).
function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

// Close a session.
function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.sseRes) {
    try { session.sseRes.end(); } catch (e) {}
  }
  sessions.delete(sessionId);
  console.log(`[mcp-service:session] closed session=${sessionId}`);
}

// Send a JSON-RPC notification to a session via SSE.
// Returns true if sent, false if session has no active SSE stream.
function sendNotification(sessionId, notification) {
  const session = sessions.get(sessionId);
  if (!session || !session.sseRes) return false;
  try {
    const data = JSON.stringify(notification);
    session.sseRes.write(`data: ${data}\n\n`);
    session.lastActivity = new Date();
    return true;
  } catch (e) {
    // SSE stream died — clean up
    session.sseRes = null;
    return false;
  }
}

// Fan out a notification to all sessions matching a filter function.
// filter(session) → boolean
function fanOut(notification, filter) {
  let sent = 0;
  for (const [, session] of sessions) {
    if (filter && !filter(session)) continue;
    if (sendNotification(session.sessionId, notification)) sent++;
  }
  return sent;
}

// Notify about an emission event.
// Per §7.1: own-entity events go to all sessions for that entity,
// kingdom-wide events go only to sessions with read.all scope.
function notifyEmission(emissionDoc, eventType) {
  const auth = globalThis.McpServiceAuth;
  if (!auth) return;

  // event: 'entity/emission.new' for new own-entity or open,
  //        'entity/emission.closed' for close,
  //        'kingdom/emission.new' for kingdom-wide
  const entity = emissionDoc.entity;
  const timestamp = (emissionDoc.timestamp || new Date()).toISOString();
  const summary = {
    _id: emissionDoc._id,
    type: emissionDoc.type,
    body: emissionDoc.body,
    timestamp,
  };

  // Own-entity notification (always, to all sessions for this entity)
  const ownEvent = (eventType === 'close') ? 'entity/emission.closed' : 'entity/emission.new';
  fanOut(
    buildNotification(ownEvent, entity, summary),
    session => session.profile.entity === entity
  );

  // Kingdom-wide notification (only to read.all sessions)
  if (eventType !== 'close') {
    fanOut(
      buildNotification('kingdom/emission.new', entity, summary),
      session => session.profile.entity !== entity && auth.hasScope(session.profile.scopes, 'read.all')
    );
  }
}

// Notify about a new inbox message for an entity.
function notifyMessage(entity, filename) {
  const summary = { filename, receivedAt: new Date().toISOString() };
  fanOut(
    buildNotification('entity/message.received', entity, summary),
    session => session.profile.entity === entity
  );
}

// Notify about a flight event (opened/closed).
function notifyFlight(flightDoc, action) {
  const entity = flightDoc.entity;
  const eventType = action === 'close' ? 'entity/flight.closed' : 'entity/flight.opened';
  const summary = {
    _id: flightDoc._id,
    briefSlug: flightDoc.briefSlug || null,
    status: action === 'close' ? 'landed' : 'flying',
    timestamp: new Date().toISOString(),
  };
  fanOut(
    buildNotification(eventType, entity, summary),
    session => session.profile.entity === entity
  );
}

function buildNotification(event, entity, data) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { event, entity, data },
  };
}

// Active session count and summary for health checks.
function activeSummary() {
  const result = [];
  for (const [, s] of sessions) {
    result.push({
      sessionId: s.sessionId,
      entity: s.profile.entity,
      hasSSE: !!s.sseRes,
      createdAt: s.createdAt.toISOString(),
      lastActivity: s.lastActivity.toISOString(),
    });
  }
  return result;
}

globalThis.McpServiceSession = {
  createSession,
  attachSSE,
  getSession,
  closeSession,
  sendNotification,
  fanOut,
  notifyEmission,
  notifyMessage,
  notifyFlight,
  activeSummary,
};
