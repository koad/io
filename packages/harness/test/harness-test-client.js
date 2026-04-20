#!/usr/bin/env node
// harness-test-client.js — exercise the harness SSE endpoint from the CLI.
//
// Usage:
//   node harness-test-client.js <entity> <message>
//
// Example:
//   node harness-test-client.js alice "Please mark sight 3 as visited. Sight number 3, title: Your Keys Are You."
//
// Reads HARNESS_URL (default: http://localhost:3000/harness/<entity>/chat)
// and HARNESS_TOKEN (required — a pre-issued DDP token, or run via:
//   HARNESS_TOKEN=$(curl -s http://localhost:3000/api/test-token) node harness-test-client.js ...
//
// The client logs all SSE events. tool_result events are logged prominently
// to verify the tool-result-to-UI bridge end-to-end.

'use strict';

const http  = require('http');
const https = require('https');

const entity  = process.argv[2];
const message = process.argv[3];

if (!entity || !message) {
  console.error('Usage: node harness-test-client.js <entity> <message>');
  process.exit(1);
}

const baseUrl  = process.env.HARNESS_URL || `http://localhost:3000/harness/${entity}/chat`;
const token    = process.env.HARNESS_TOKEN || 'test-token';

const body = JSON.stringify({
  entity,
  message,
  sessionId: null,
  ddpToken:  token,
});

const url  = new URL(baseUrl);
const lib  = url.protocol === 'https:' ? https : http;

const options = {
  hostname: url.hostname,
  port:     url.port || (url.protocol === 'https:' ? 443 : 80),
  path:     url.pathname + (url.search || ''),
  method:   'POST',
  headers: {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

console.log(`[test-client] → POST ${baseUrl}`);
console.log(`[test-client]   entity:  ${entity}`);
console.log(`[test-client]   message: ${message}`);
console.log('');

const req = lib.request(options, (res) => {
  if (res.statusCode !== 200) {
    let errBody = '';
    res.on('data', (d) => { errBody += d; });
    res.on('end', () => {
      console.error(`[test-client] HTTP ${res.statusCode}: ${errBody}`);
      process.exit(1);
    });
    return;
  }

  let buffer = '';

  res.on('data', (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split('\n\n');
    buffer = parts.pop();

    for (const block of parts) {
      if (!block.trim()) continue;

      let eventType = 'message';
      let dataStr   = '';

      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6);
      }

      if (!dataStr) continue;

      let data;
      try {
        data = JSON.parse(dataStr);
      } catch (e) {
        console.warn(`[sse:parse-error] ${dataStr}`);
        continue;
      }

      switch (eventType) {
        case 'session':
          console.log(`[sse:session]     sessionId=${data.sessionId}`);
          break;

        case 'chunk':
          // Print text chunks inline without newlines
          process.stdout.write(data.text || '');
          break;

        case 'done':
          // Newline after inline chunks
          process.stdout.write('\n');
          console.log(`[sse:done]        usage=${JSON.stringify(data.usage || null)}`);
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

        case 'error':
          process.stdout.write('\n');
          console.error(`[sse:error]       message=${data.message} fallback=${data.fallback}`);
          break;

        default:
          console.log(`[sse:${eventType}]       ${JSON.stringify(data)}`);
      }
    }
  });

  res.on('end', () => {
    console.log('[test-client] stream ended');
  });

  res.on('error', (err) => {
    console.error('[test-client] response error:', err.message);
    process.exit(1);
  });
});

req.on('error', (err) => {
  console.error('[test-client] request error:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
