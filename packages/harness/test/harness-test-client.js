#!/usr/bin/env node
// harness-test-client.js — programmatic test client for the koad:io web harness
//
// Connects to the Meteor app via DDP (SockJS WebSocket), acquires a harness.token,
// then sends a chat message to the specified entity via POST /harness/<entity>/chat.
// Reads the SSE response stream and prints all events.
//
// Usage:
//   node harness-test-client.js <entity> "<message>" [base-url]
//
// Examples:
//   node harness-test-client.js juno "hello, what can you do?"
//   node harness-test-client.js vulcan "describe your role" http://10.10.10.10:20522
//
// Dependencies: Node built-ins only (WebSocket is built-in since Node 22).
// Node 21+ required for globalThis.WebSocket.

'use strict';

const http = require('http');

// ── Config ────────────────────────────────────────────────────────────────────

const ENTITY  = process.argv[2];
const MESSAGE = process.argv[3];
const BASE    = process.argv[4] || 'http://10.10.10.10:20522';

if (!ENTITY || !MESSAGE) {
  console.error('Usage: node harness-test-client.js <entity> "<message>" [base-url]');
  console.error('');
  console.error('Examples:');
  console.error('  node harness-test-client.js juno "hello, what tools do you have?"');
  console.error('  node harness-test-client.js vulcan "describe your role"');
  process.exit(1);
}

// Parse BASE url into host/port
const baseUrl  = new URL(BASE.startsWith('http') ? BASE : `http://${BASE}`);
const HOST     = baseUrl.hostname;
const PORT     = parseInt(baseUrl.port || '80', 10);

// ── DDP / SockJS helpers ──────────────────────────────────────────────────────

// Meteor DDP runs over SockJS. SockJS frames messages as:
//   o              — connection open
//   h              — heartbeat
//   a["<json>"]    — array of DDP message strings
//   c[code,"msg"]  — close
//
// To send: ws.send(JSON.stringify([JSON.stringify(ddpMsg)]))

function ddpFrame(msg) {
  return JSON.stringify([JSON.stringify(msg)]);
}

function parseSockJsFrame(data) {
  if (data === 'o' || data === 'h') return [];  // open / heartbeat
  if (!data.startsWith('a')) return [];          // close or unknown
  try {
    const arr = JSON.parse(data.slice(1));
    return arr.map(s => JSON.parse(s));
  } catch (_) {
    return [];
  }
}

// ── Step 1: acquire DDP token ─────────────────────────────────────────────────

function acquireToken() {
  return new Promise((resolve, reject) => {
    // Random SockJS session path: /sockjs/<server>/<session>/websocket
    const server  = Math.floor(Math.random() * 900 + 100);
    const session = Math.random().toString(36).slice(2, 10);
    const wsUrl   = `ws://${HOST}:${PORT}/sockjs/${server}/${session}/websocket`;

    console.log(`[ddp] connecting: ${wsUrl}`);

    if (typeof WebSocket === 'undefined') {
      return reject(new Error('WebSocket not available — requires Node 22+'));
    }

    const ws    = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('DDP token acquisition timeout (10s)'));
    }, 10000);

    ws.onopen = () => {
      console.log('[ddp] socket open → sending connect');
      ws.send(ddpFrame({ msg: 'connect', version: '1', support: ['1'] }));
    };

    ws.onmessage = (e) => {
      const msgs = parseSockJsFrame(e.data);
      for (const msg of msgs) {
        if (msg.msg === 'connected') {
          console.log(`[ddp] connected session=${msg.session} → calling harness.token`);
          ws.send(ddpFrame({ msg: 'method', id: '1', method: 'harness.token', params: [] }));
        }
        if (msg.msg === 'result' && msg.id === '1') {
          clearTimeout(timer);
          ws.close();
          if (msg.error) {
            reject(new Error(`harness.token error: ${msg.error.reason || msg.error.error}`));
          } else {
            console.log(`[ddp] token acquired (${msg.result.length} chars)`);
            resolve(msg.result);
          }
        }
      }
    };

    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${e.message || e.type}`));
    };
  });
}

// ── Step 2: POST chat, parse SSE ──────────────────────────────────────────────

function chat(entity, message, ddpToken) {
  return new Promise((resolve, reject) => {
    const path    = `/harness/${entity}/chat`;
    const payload = JSON.stringify({ entity, message, sessionId: null, ddpToken });

    console.log(`[chat] POST ${HOST}:${PORT}${path}`);
    console.log(`[chat] entity=${entity} message="${message}"`);
    console.log('');

    const req = http.request(
      {
        host:    HOST,
        port:    PORT,
        path,
        method:  'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', d => { body += d; });
          res.on('end',  () => reject(new Error(`HTTP ${res.statusCode}: ${body}`)));
          return;
        }

        let fullText     = '';
        let sessionId    = null;
        let usageData    = null;
        let toolUseEvents = [];
        let buffer       = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          // SSE spec: events separated by double newline
          const events = buffer.split('\n\n');
          buffer = events.pop(); // keep incomplete trailing fragment

          for (const block of events) {
            if (!block.trim()) continue;

            let eventType = 'message';
            let dataLine  = '';

            for (const line of block.split('\n')) {
              if (line.startsWith('event: '))      eventType = line.slice(7).trim();
              else if (line.startsWith('data: '))  dataLine  = line.slice(6).trim();
            }

            if (!dataLine) continue;

            let data;
            try {
              data = JSON.parse(dataLine);
            } catch (_) {
              console.log(`[sse] raw (${eventType}): ${dataLine}`);
              continue;
            }

            // Print every SSE event for debugging
            process.stdout.write(`[sse:${eventType}] `);

            switch (eventType) {
              case 'session':
                sessionId = data.sessionId;
                console.log(`sessionId=${sessionId}`);
                break;

              case 'chunk':
                process.stdout.write(data.text || '');
                fullText += (data.text || '');
                break;

              case 'tool_use':
                console.log(`\n[tool_use] ${JSON.stringify(data)}`);
                toolUseEvents.push(data);
                break;

              case 'tool_result':
                // Prominent log — this proves the bridge is working
                process.stdout.write('\n');
                console.log('┌─────────────────────────────────────────────');
                console.log(`│ [sse:tool_result] tool=${data.tool}`);
                console.log(`│   params: ${JSON.stringify(data.params)}`);
                console.log(`│   result: ${JSON.stringify(data.result)}`);
                console.log('└─────────────────────────────────────────────');
                break;

              case 'done':
                usageData = data.usage || null;
                // done.fullText is the canonical cleaned text
                if (data.fullText && data.fullText !== fullText) {
                  fullText = data.fullText;
                }
                console.log(''); // newline after streaming chunks
                console.log(`\n[done] usage=${JSON.stringify(usageData || {})}`);
                break;

              case 'error':
                console.log(`ERROR: ${data.message} fallback="${data.fallback || ''}"`);
                break;

              default:
                console.log(JSON.stringify(data));
            }
          }
        });

        res.on('end', () => {
          resolve({ sessionId, fullText, usage: usageData, toolUseEvents });
        });

        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    // Step 1: DDP token
    const token = await acquireToken();

    // Step 2: chat
    const result = await chat(ENTITY, MESSAGE, token);

    // Summary
    console.log('');
    console.log('─'.repeat(60));
    console.log('RESULT');
    console.log('─'.repeat(60));
    console.log(`entity:     ${ENTITY}`);
    console.log(`sessionId:  ${result.sessionId}`);
    if (result.toolUseEvents.length > 0) {
      console.log(`tool_use:   ${result.toolUseEvents.length} event(s)`);
      result.toolUseEvents.forEach((t, i) => {
        console.log(`  [${i}] ${JSON.stringify(t)}`);
      });
    }
    if (result.usage) {
      const u = result.usage;
      console.log(`tokens:     prompt=${u.prompt_tokens} completion=${u.completion_tokens} total=${u.total_tokens}`);
      if (u._rates) {
        const cost = ((u.prompt_tokens || 0) * u._rates.input + (u.completion_tokens || 0) * u._rates.output) / 1_000_000;
        console.log(`cost:       $${cost.toFixed(6)} (in=${u._rates.input} out=${u._rates.output} per 1M)`);
      }
    }
    console.log('─'.repeat(60));
    console.log('RESPONSE TEXT:');
    console.log(result.fullText);
    console.log('─'.repeat(60));

    process.exit(0);
  } catch (err) {
    console.error('\nFATAL:', err.message);
    process.exit(1);
  }
})();
