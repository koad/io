#!/usr/bin/env node
/**
 * bridge.js — Harness Bridge Protocol inbound companion (VESTA-SPEC-191)
 *
 * Subscribes to the daemon's SSE stream and injects commands into a running
 * opencode session via its TUI HTTP API.
 *
 * Env contract:
 *   KOAD_IO_OPENCODE_SSE_PORT  (required) — port opencode TUI is listening on
 *   HARNESS_SESSION_ID         (required) — stable session ID for this harness
 *   ENTITY                     (required) — entity handle (e.g. "vesta")
 *   KOAD_IO_BIND_IP            (optional) — bind address; default 127.0.0.1
 *   KOAD_IO_DAEMON_URL         (optional) — daemon base URL; default http://10.10.10.10:28282
 *
 * Spawned by command.sh alongside sidecar.py. Dies when parent harness exits.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SSE_PORT = process.env.KOAD_IO_OPENCODE_SSE_PORT || '';
const SESSION_ID = process.env.HARNESS_SESSION_ID || '';
const ENTITY = process.env.ENTITY || 'unknown';
const BIND_IP = process.env.KOAD_IO_BIND_IP || '127.0.0.1';
const DAEMON_URL = process.env.KOAD_IO_DAEMON_URL || 'http://10.10.10.10:28282';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TURN_GATE_TIMEOUT_MS = 500;     // how long to tail /global/event looking for finish
const TURN_GATE_POLL_MS = 2000;       // how often to re-check turn gate
const TURN_GATE_MAX_WAIT_MS = 120000; // max wait before reporting turn_gate_timeout

const RECONNECT_INIT_MS = 2000;       // initial reconnect delay
const RECONNECT_MAX_MS = 30000;       // max reconnect delay
const RECONNECT_MAX_FAILURES = 10;    // exit after this many consecutive failures

const PARENT_PID = process.ppid;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _paused = false;
let _pauseQueue = [];          // commands queued while paused
let _localQueue = new Map();   // cmdId → cmd (for dedup on reconnect)
let _dispatchedIds = new Set(); // cmdIds already dispatched (for dedup)
let _noReconnect = false;       // set true after harness_close

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(`[bridge:${ENTITY}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// HTTP helpers — no external dependencies, built-in http only
// ---------------------------------------------------------------------------

function httpRequest(method, urlStr, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    if (timeoutMs) options.timeout = timeoutMs;

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    if (timeoutMs) {
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`timeout after ${timeoutMs}ms`));
      });
    }
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function daemonPost(path, body) {
  return httpRequest('POST', `${DAEMON_URL}${path}`, body, 5000);
}

function daemonPut(path, body) {
  return httpRequest('PUT', `${DAEMON_URL}${path}`, body, 5000);
}

function daemonDelete(path) {
  return httpRequest('DELETE', `${DAEMON_URL}${path}`, null, 5000);
}

function tuiPost(path, body) {
  const base = `http://${BIND_IP}:${SSE_PORT}`;
  return httpRequest('POST', `${base}${path}`, body, 10000);
}

function tuiGet(path) {
  const base = `http://${BIND_IP}:${SSE_PORT}`;
  return httpRequest('GET', `${base}${path}`, null, 10000);
}

// ---------------------------------------------------------------------------
// Status reporting back to daemon
// ---------------------------------------------------------------------------

async function reportStatus(cmdId, status, extras) {
  const body = { status };
  if (extras) Object.assign(body, extras);
  try {
    await daemonPut(`/harness/commands/${cmdId}/status`, body);
  } catch (e) {
    log(`WARN: failed to report status for ${cmdId}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Registration / deregistration
// ---------------------------------------------------------------------------

async function register() {
  const pid = process.pid;
  const host = require('os').hostname();
  try {
    const r = await daemonPost(
      `/harness/bridge/${ENTITY}/${SESSION_ID}/register`,
      { pid, host }
    );
    log(`registered with daemon (status ${r.status})`);
  } catch (e) {
    log(`WARN: registration failed: ${e.message} — continuing anyway`);
  }
}

function deregister() {
  // Fire-and-forget — don't await
  daemonDelete(`/harness/bridge/${ENTITY}/${SESSION_ID}/register`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Turn gate — check if opencode is idle (finish == 'stop')
// ---------------------------------------------------------------------------

function tailEventOnce(timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(`http://${BIND_IP}:${SSE_PORT}/global/event`);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      timeout: timeoutMs + 500,
    };

    const req = http.request(options, (res) => {
      let buf = '';
      let lastFinish = null;
      let seenAssistant = false;
      const deadline = Date.now() + timeoutMs;

      res.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const event = JSON.parse(trimmed.slice(5).trim());
            const etype = event.type || '';
            const props = event.properties || {};
            if (etype === 'message.updated') {
              const info = props.info || {};
              if (info.role === 'assistant') {
                seenAssistant = true;
                if (info.finish !== undefined) lastFinish = info.finish;
              }
            }
          } catch (e) { /* skip malformed */ }
        }

        if (Date.now() >= deadline) {
          req.destroy();
          resolve({ seenAssistant, lastFinish });
        }
      });

      res.on('end', () => resolve({ seenAssistant, lastFinish }));
      res.on('error', () => resolve({ seenAssistant, lastFinish }));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ seenAssistant: false, lastFinish: null });
    });
    req.on('error', () => resolve({ seenAssistant: false, lastFinish: null }));
    req.end();
  });
}

async function isTurnIdle() {
  const { seenAssistant, lastFinish } = await tailEventOnce(TURN_GATE_TIMEOUT_MS);
  if (!seenAssistant) return true; // no assistant message yet — session is idle
  return lastFinish === 'stop';
}

// Wait until turn is idle, checking every TURN_GATE_POLL_MS.
// Returns true if idle before timeout, false if gate timed out.
async function waitForIdle() {
  const deadline = Date.now() + TURN_GATE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isTurnIdle()) return true;
    await new Promise(r => setTimeout(r, TURN_GATE_POLL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

async function executeCommand(cmd) {
  const { id, cmd: type, payload } = cmd;

  // Dedup: skip if already dispatched
  if (_dispatchedIds.has(id)) {
    log(`skipping duplicate command ${id}`);
    return;
  }
  _dispatchedIds.add(id);
  _localQueue.delete(id);

  log(`executing ${type} (${id})`);

  if (type === 'ping') {
    // Query current session state
    try {
      const r = await tuiGet(`/session/${SESSION_ID}/message?limit=5`);
      const items = Array.isArray(r.body) ? r.body : (r.body.messages || r.body.items || []);
      const assistantMsgs = items.filter(m => {
        const role = m.role || (m.info && m.info.role) || '';
        return role === 'assistant';
      });
      if (assistantMsgs.length === 0) {
        await reportStatus(id, 'executed', {
          result: { role: null, finish: null, snippet: null }
        });
        return;
      }
      const latest = assistantMsgs[assistantMsgs.length - 1];
      const info = latest.info || latest;
      const parts = latest.parts || [];
      const text = parts.filter(p => p.type === 'text').map(p => p.text || '').join('');
      await reportStatus(id, 'executed', {
        result: {
          role: info.role || 'assistant',
          finish: info.finish || null,
          snippet: text.slice(0, 200),
        }
      });
    } catch (e) {
      await reportStatus(id, 'failed', { reason: `ping error: ${e.message}` });
    }
    return;
  }

  if (type === 'pause') {
    _paused = true;
    log('bridge paused');
    await reportStatus(id, 'executed');
    return;
  }

  if (type === 'resume') {
    _paused = false;
    log(`bridge resumed, flushing ${_pauseQueue.length} queued commands`);
    const queued = _pauseQueue.splice(0);
    for (const qCmd of queued) {
      // Subject to turn gate per §5.7
      setImmediate(() => dispatchWithTurnGate(qCmd));
    }
    await reportStatus(id, 'executed');
    return;
  }

  if (type === 'inject' || type === 'append') {
    if (_paused) {
      _pauseQueue.push(cmd);
      _dispatchedIds.delete(id); // allow re-dispatch after resume
      log(`queued ${type} command ${id} (paused)`);
      // Don't report status yet — will be executed after resume
      return;
    }
    await dispatchWithTurnGate(cmd);
    return;
  }

  log(`unknown command type: ${type}`);
  await reportStatus(id, 'failed', { reason: `unknown command type: ${type}` });
}

async function dispatchWithTurnGate(cmd) {
  const { id, cmd: type, payload } = cmd;
  const text = (payload && payload.text) || '';

  const idle = await waitForIdle();
  if (!idle) {
    await reportStatus(id, 'failed', { reason: 'turn_gate_timeout' });
    return;
  }

  if (type === 'inject') {
    // append-prompt + submit-prompt
    try {
      await tuiPost('/tui/append-prompt', { text });
      await tuiPost('/tui/submit-prompt', {});
      await reportStatus(id, 'executed');
    } catch (e) {
      await reportStatus(id, 'failed', { reason: `inject error: ${e.message}` });
    }
    return;
  }

  if (type === 'append') {
    // append-prompt only (no submit)
    try {
      await tuiPost('/tui/append-prompt', { text });
      await reportStatus(id, 'executed');
    } catch (e) {
      await reportStatus(id, 'failed', { reason: `append error: ${e.message}` });
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// SSE stream parsing — tail daemon's /harness/stream/:entity/:sessionId
// ---------------------------------------------------------------------------

function parseSseFrame(rawLines) {
  let eventType = null;
  let dataLine = null;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      eventType = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      dataLine = trimmed.slice(5).trim();
    }
  }
  if (!eventType || dataLine === null) return null;
  try {
    return { event: eventType, data: JSON.parse(dataLine) };
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parent death detection
// ---------------------------------------------------------------------------

const _parentPollInterval = setInterval(() => {
  if (process.ppid !== PARENT_PID) {
    log('parent process died — exiting');
    cleanup();
    process.exit(0);
  }
}, 2000);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup() {
  clearInterval(_parentPollInterval);
  deregister();
}

// ---------------------------------------------------------------------------
// Signal handling
// ---------------------------------------------------------------------------

function onSignal() {
  log('received signal — cleaning up');
  cleanup();
  process.exit(0);
}

process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);

// stdin EOF — parent closed stdin
process.stdin.on('end', () => {
  log('stdin EOF — parent exited, cleaning up');
  cleanup();
  process.exit(0);
});
process.stdin.resume();

// ---------------------------------------------------------------------------
// Main SSE connection loop with exponential backoff reconnect
// ---------------------------------------------------------------------------

async function connectAndListen() {
  let reconnectDelay = RECONNECT_INIT_MS;
  let consecutiveFailures = 0;

  while (!_noReconnect) {
    try {
      await openSseConnection();
      // If we get here cleanly, reset failure counter
      consecutiveFailures = 0;
      reconnectDelay = RECONNECT_INIT_MS;

      if (_noReconnect) break;
      log(`SSE connection closed — reconnecting in ${reconnectDelay}ms`);
    } catch (e) {
      consecutiveFailures++;
      log(`SSE connection error (attempt ${consecutiveFailures}/${RECONNECT_MAX_FAILURES}): ${e.message}`);

      if (consecutiveFailures >= RECONNECT_MAX_FAILURES) {
        log('max reconnect failures reached — exiting');
        cleanup();
        process.exit(1);
      }

      log(`reconnecting in ${reconnectDelay}ms`);
    }

    if (_noReconnect) break;
    await new Promise(r => setTimeout(r, reconnectDelay));
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}

function openSseConnection() {
  return new Promise((resolve, reject) => {
    const streamUrl = `${DAEMON_URL}/harness/stream/${ENTITY}/${SESSION_ID}`;
    const u = new URL(streamUrl);
    const options = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    };

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE endpoint returned ${res.statusCode}`));
        res.resume(); // drain
        return;
      }

      log(`SSE stream open (${DAEMON_URL}/harness/stream/${ENTITY}/${SESSION_ID})`);

      let buf = '';
      let currentFrameLines = [];

      res.on('data', (chunk) => {
        buf += chunk.toString();
        const parts = buf.split('\n');
        buf = parts.pop(); // keep incomplete line

        for (const line of parts) {
          if (line.trim() === '') {
            // Blank line = end of SSE frame
            if (currentFrameLines.length > 0) {
              const frame = parseSseFrame(currentFrameLines);
              currentFrameLines = [];
              if (frame) handleSseFrame(frame);
            }
          } else {
            currentFrameLines.push(line);
          }
        }
      });

      res.on('end', () => resolve());
      res.on('error', (e) => reject(e));
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// SSE frame dispatcher
// ---------------------------------------------------------------------------

function handleSseFrame(frame) {
  const { event, data } = frame;

  if (event === 'harness_ping') {
    // Liveness keepalive — ignore
    return;
  }

  if (event === 'harness_close') {
    log(`received harness_close: ${data.reason || 'no reason'} — exiting`);
    _noReconnect = true;
    cleanup();
    process.exit(0);
  }

  if (event === 'harness_error') {
    const code = data.code || 'unknown';
    log(`received harness_error code=${code}: ${data.message || ''}`);
    if (code === 'duplicate_stream') {
      log('another bridge is active — exiting');
      _noReconnect = true;
      cleanup();
      process.exit(0);
    }
    if (code === 'session_not_found') {
      log('session not found on daemon — exiting');
      _noReconnect = true;
      cleanup();
      process.exit(0);
    }
    // internal_error — allow reconnect
    return;
  }

  if (event === 'harness_command') {
    const cmd = data;
    if (!cmd || !cmd.id || !cmd.cmd) {
      log(`malformed harness_command frame: ${JSON.stringify(data)}`);
      return;
    }

    // Dedup: skip if already in local queue or dispatched
    if (_dispatchedIds.has(cmd.id) || _localQueue.has(cmd.id)) {
      log(`dedup: skipping already-seen command ${cmd.id}`);
      return;
    }

    // Queue locally for reconnect survival
    _localQueue.set(cmd.id, cmd);

    // Execute asynchronously (don't block SSE read loop)
    setImmediate(() => executeCommand(cmd));
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  // Guard: exit silently if SSE port not set (same pattern as sidecar.py)
  if (!SSE_PORT) {
    process.exit(0);
  }

  if (!SESSION_ID) {
    log('HARNESS_SESSION_ID not set — exiting');
    process.exit(1);
  }

  log(`starting (entity=${ENTITY} session=${SESSION_ID} daemon=${DAEMON_URL})`);

  // Step 1: register with daemon
  await register();

  // Step 2: open SSE connection loop
  await connectAndListen();

  // If we exit the loop without error, clean exit
  cleanup();
  process.exit(0);
}

main().catch(e => {
  log(`fatal: ${e.message}`);
  cleanup();
  process.exit(1);
});
