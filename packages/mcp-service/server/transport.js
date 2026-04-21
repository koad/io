// transport.js — HTTP+SSE transport for MCP
// VESTA-SPEC-139 §4 — MCP 2024-11-05 protocol
//
// Two sub-paths:
//   POST /mcp     — client sends JSON-RPC messages (tool calls, initialize)
//   GET  /mcp/sse — client opens SSE stream to receive responses + notifications
//
// Session correlation via Mcp-Session-Id header.
// Authorization via Bearer token in Authorization header.

'use strict';

const MCP_PROTOCOL_VERSION = '2024-11-05';

// JSON-RPC response builders
function jsonRpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

// Standard MCP error codes
const MCP_ERRORS = {
  PARSE_ERROR:          -32700,
  INVALID_REQUEST:      -32600,
  METHOD_NOT_FOUND:     -32601,
  INVALID_PARAMS:       -32602,
  INTERNAL_ERROR:       -32603,
  PROTOCOL_VERSION:      -32000,
  UNAUTHORIZED:          -32001,
  SCOPE_INSUFFICIENT:    -32002,
};

// Build the tool list for a session (entity cascade + daemon state tools).
function buildToolList(profile) {
  const entityTools = (globalThis.McpServiceToolLoader && globalThis.McpServiceToolLoader.loadEntityTools)
    ? globalThis.McpServiceToolLoader.loadEntityTools(profile.entity)
    : [];

  const daemonToolDefs = (globalThis.McpDaemonTools || []).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }));

  const entityToolDefs = entityTools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
    _handler: t.handler,
  }));

  return { entityToolDefs, daemonToolDefs, entityTools };
}

// Handle MCP initialize request.
function handleInitialize(req_id, params) {
  if (params && params.protocolVersion && params.protocolVersion !== MCP_PROTOCOL_VERSION) {
    return jsonRpcError(req_id, MCP_ERRORS.PROTOCOL_VERSION, 'PROTOCOL_VERSION_MISMATCH', {
      expected: MCP_PROTOCOL_VERSION,
      received: params.protocolVersion,
    });
  }

  return jsonRpcSuccess(req_id, {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
      notifications: {},
    },
    serverInfo: {
      name: 'kingdom-mcp-service',
      version: '1.0.0',
    },
  });
}

// Handle tools/list request.
function handleToolsList(req_id, profile) {
  const { entityToolDefs, daemonToolDefs } = buildToolList(profile);

  // Combine — entity tools first, then daemon tools
  const all = [
    ...entityToolDefs.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    ...daemonToolDefs,
  ];

  return jsonRpcSuccess(req_id, { tools: all });
}

// Handle tools/call request.
async function handleToolCall(req_id, params, profile) {
  const toolName = params && params.name;
  const toolArgs = (params && params.arguments) || {};

  if (!toolName) {
    return jsonRpcError(req_id, MCP_ERRORS.INVALID_PARAMS, 'Missing tool name');
  }

  // Check if it's a daemon tool
  if (toolName.startsWith('daemon.')) {
    const daemonTools = globalThis.McpDaemonTools || [];
    const tool = daemonTools.find(t => t.name === toolName);
    if (!tool) {
      return jsonRpcError(req_id, MCP_ERRORS.METHOD_NOT_FOUND, `Unknown daemon tool: ${toolName}`);
    }

    try {
      const result = await tool.handler(toolArgs, profile);
      return jsonRpcSuccess(req_id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      });
    } catch (e) {
      if (e && e.mcpError) {
        return jsonRpcError(req_id, MCP_ERRORS.SCOPE_INSUFFICIENT, e.message, { code: e.mcpError });
      }
      console.error(`[mcp-service:transport] daemon tool error ${toolName}:`, e.message);
      return jsonRpcError(req_id, MCP_ERRORS.INTERNAL_ERROR, e.message);
    }
  }

  // Entity cascade tool
  const entityTools = (globalThis.McpServiceToolLoader && globalThis.McpServiceToolLoader.loadEntityTools)
    ? globalThis.McpServiceToolLoader.loadEntityTools(profile.entity)
    : [];

  const tool = entityTools.find(t => t.name === toolName);
  if (!tool) {
    return jsonRpcError(req_id, MCP_ERRORS.METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
  }

  const context = {
    entity:    profile.entity,
    sessionId: null, // MCP session — no Meteor session ID in this context
    userId:    null,
    settings:  Meteor.settings || {},
    transport: 'mcp',
  };

  try {
    const result = await tool.handler(toolArgs, context);
    const content = (typeof result === 'string')
      ? [{ type: 'text', text: result }]
      : [{ type: 'text', text: JSON.stringify(result, null, 2) }];

    return jsonRpcSuccess(req_id, { content });
  } catch (e) {
    console.error(`[mcp-service:transport] entity tool error ${toolName}:`, e.message);
    return jsonRpcError(req_id, MCP_ERRORS.INTERNAL_ERROR, e.message);
  }
}

// Dispatch a JSON-RPC message to the appropriate handler.
// Returns a JSON-RPC response object (or null for notifications that need no response).
async function dispatchMessage(message, profile) {
  const { id, method, params } = message;

  if (!method) {
    return jsonRpcError(id || null, MCP_ERRORS.INVALID_REQUEST, 'Missing method');
  }

  if (method === 'initialize') {
    return handleInitialize(id, params);
  }

  if (method === 'tools/list') {
    return handleToolsList(id, profile);
  }

  if (method === 'tools/call') {
    return await handleToolCall(id, params, profile);
  }

  // Notifications from client (no response needed)
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }

  return jsonRpcError(id || null, MCP_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
}

// Mount the MCP transport on WebApp.rawConnectHandlers so it runs before
// Meteor's Blaze HTML-serving catch-all, which would otherwise swallow the
// /mcp and /mcp/sse routes and return the HTML shell instead of JSON-RPC/SSE.
function mountMcpTransport() {
  const app = WebApp.rawConnectHandlers;

  // -------------------------------------------------------------------------
  // GET /mcp — SSE stream (MCP streamable HTTP transport, MCP spec 2024-11-05)
  // Claude Code GETs the same endpoint URL it POSTs to in order to open the
  // SSE notification stream.  Without this handler the request fell through
  // all connect middleware and hit Blaze's HTML catch-all; the SDK tried to
  // parse HTML as JSON and failed.
  //
  // Auth: prefer Bearer token (creates/finds session), fall back to
  // Mcp-Session-Id header so the existing /mcp/sse sub-path behaviour
  // is mirrored exactly.
  // -------------------------------------------------------------------------
  app.use('/mcp', (req, res, next) => {
    if (req.method !== 'GET') return next();

    const McpAuth    = globalThis.McpServiceAuth;
    const McpSession = globalThis.McpServiceSession;

    if (!McpSession) {
      res.writeHead(503);
      return res.end(JSON.stringify({ error: 'MCP service not ready' }));
    }

    // Resolve session — Bearer token takes priority, then Mcp-Session-Id header
    let sessionId = null;
    let session   = null;

    const authHeader = req.headers['authorization'] || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (tokenMatch && McpAuth) {
      const token   = tokenMatch[1];
      const profile = McpAuth.authenticateSession(token);
      if (!profile) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Unauthorized: invalid or expired session token' }));
      }
      // Re-use any existing session for this profile, or create a new one
      sessionId = McpSession.createSession(profile);
      session   = McpSession.getSession(sessionId);
    } else {
      sessionId = req.headers['mcp-session-id'];
      if (!sessionId) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Missing Authorization or Mcp-Session-Id header' }));
      }
      session = McpSession.getSession(sessionId);
      if (!session) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Invalid or expired session' }));
      }
    }

    // Set up SSE stream
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Mcp-Session-Id': sessionId,
    });
    res.write('\n'); // flush headers

    // Attach to session
    McpSession.attachSSE(sessionId, res);
    console.log(`[mcp-service:sse] stream opened session=${sessionId} entity=${session.profile.entity}`);

    // Keep-alive ping every 30s
    const ping = Meteor.setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) {
        Meteor.clearInterval(ping);
        McpSession.closeSession(sessionId);
      }
    }, 30000);

    req.on('close', () => {
      Meteor.clearInterval(ping);
      McpSession.closeSession(sessionId);
      console.log(`[mcp-service:sse] stream closed session=${sessionId}`);
    });
  });

  // -------------------------------------------------------------------------
  // GET /mcp/sse — legacy SSE path kept for backward compatibility
  // -------------------------------------------------------------------------
  app.use('/mcp/sse', (req, res, next) => {
    if (req.method !== 'GET') return next();

    // Extract and verify session
    const sessionId = req.headers['mcp-session-id'];
    const McpSession = globalThis.McpServiceSession;

    if (!sessionId || !McpSession) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Missing Mcp-Session-Id header' }));
    }

    const session = McpSession.getSession(sessionId);
    if (!session) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Invalid or expired session' }));
    }

    // Set up SSE stream
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('\n'); // flush headers

    // Attach to session
    McpSession.attachSSE(sessionId, res);
    console.log(`[mcp-service:sse] stream opened session=${sessionId} entity=${session.profile.entity}`);

    // Keep-alive ping every 30s
    const ping = Meteor.setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) {
        Meteor.clearInterval(ping);
        McpSession.closeSession(sessionId);
      }
    }, 30000);

    req.on('close', () => {
      Meteor.clearInterval(ping);
      McpSession.closeSession(sessionId);
      console.log(`[mcp-service:sse] stream closed session=${sessionId}`);
    });
  });

  // -------------------------------------------------------------------------
  // OPTIONS /mcp — CORS preflight
  // -------------------------------------------------------------------------
  app.use('/mcp', (req, res, next) => {
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.writeHead(204);
    res.end();
  });

  // -------------------------------------------------------------------------
  // Body-parser for /mcp POST — rawConnectHandlers doesn't include one
  // -------------------------------------------------------------------------
  app.use('/mcp', (req, res, next) => {
    if (req.method !== 'POST') return next();
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        req.body = JSON.parse(data);
      } catch (e) {
        req.body = null;
      }
      next();
    });
  });

  // -------------------------------------------------------------------------
  // POST /mcp — JSON-RPC message dispatch
  // -------------------------------------------------------------------------
  app.use('/mcp', async (req, res, next) => {
    if (req.method !== 'POST') return next();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const body = req.body;
    if (!body || typeof body !== 'object') {
      res.writeHead(400);
      return res.end(JSON.stringify(jsonRpcError(null, MCP_ERRORS.PARSE_ERROR, 'Invalid JSON body')));
    }

    const McpAuth    = globalThis.McpServiceAuth;
    const McpSession = globalThis.McpServiceSession;

    if (!McpAuth || !McpSession) {
      res.writeHead(503);
      return res.end(JSON.stringify(jsonRpcError(null, MCP_ERRORS.INTERNAL_ERROR, 'MCP service not ready')));
    }

    // Check for existing session or authenticate a new one
    const sessionIdHeader = req.headers['mcp-session-id'];
    let session = sessionIdHeader ? McpSession.getSession(sessionIdHeader) : null;

    if (!session) {
      // Authenticate via Bearer token
      const authHeader = req.headers['authorization'] || '';
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Unauthorized: Bearer token required' }));
      }

      const token = tokenMatch[1];
      const profile = McpAuth.authenticateSession(token);
      if (!profile) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Unauthorized: invalid or expired session token' }));
      }

      // Create new MCP session
      const newSessionId = McpSession.createSession(profile);
      session = McpSession.getSession(newSessionId);

      // Return session ID in response header
      res.setHeader('Mcp-Session-Id', newSessionId);
    }

    const { profile } = session;
    session.lastActivity = new Date();

    // Dispatch the message
    let response;
    try {
      response = await dispatchMessage(body, profile);
    } catch (e) {
      console.error('[mcp-service:transport] dispatch error:', e.message);
      res.writeHead(500);
      return res.end(JSON.stringify(jsonRpcError(body.id || null, MCP_ERRORS.INTERNAL_ERROR, e.message)));
    }

    if (response === null) {
      // Notification — no response body
      res.writeHead(204);
      return res.end();
    }

    // Send response directly via HTTP (synchronous request-response path)
    // Also push to SSE stream if open
    if (session.sseRes) {
      try {
        const data = JSON.stringify(response);
        session.sseRes.write(`data: ${data}\n\n`);
      } catch (e) { /* SSE stream dead */ }
    }

    res.writeHead(200);
    res.end(JSON.stringify(response));
  });

  console.log('[mcp-service] MCP endpoint mounted at /mcp (GET SSE + POST JSON-RPC) and /mcp/sse (GET legacy)');
}

globalThis.McpServiceTransport = { mountMcpTransport };
