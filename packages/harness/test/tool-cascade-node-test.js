#!/usr/bin/env node
// tool-cascade Node-runnable tests
// Run: node test/tool-cascade-node-test.js
//
// Tests the tool cascade loader (server/tool-cascade.js) inline
// using a temp directory fixture, without Meteor globals.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Load the cascade module ───────────────────────────────────────────────────
// tool-cascade.js is a Meteor-style file that assigns KoadHarnessToolCascade
// to the global scope. We load it by requiring it directly — Node CJS module
// system makes require/fs/path available, and the globalThis assignment works.
require(path.resolve(__dirname, '../server/tool-cascade.js'));

const cascade = globalThis.KoadHarnessToolCascade;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
  }
}

function assertEqual(a, b, label) {
  const aS = JSON.stringify(a);
  const bS = JSON.stringify(b);
  if (aS === bS) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
    console.error(`         expected: ${bS}`);
    console.error(`         got:      ${aS}`);
  }
}

// Create a temp directory tree for a fixture tool
function makeTool(baseDir, toolName, toolJson, handlerFn) {
  const toolDir = path.join(baseDir, toolName);
  fs.mkdirSync(toolDir, { recursive: true });
  fs.writeFileSync(path.join(toolDir, 'tool.json'), JSON.stringify(toolJson));
  fs.writeFileSync(path.join(toolDir, 'handler.js'), handlerFn);
  return toolDir;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const validToolJson = {
  name:        'leave_message',
  description: 'Leave a message for another entity.',
  version:     '1.0.0',
  invocation:  'native',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target entity handle' },
      body:   { type: 'string', description: 'Message body' },
    },
    required: ['target', 'body'],
  },
};

const validHandlerSrc = `
'use strict';
module.exports = async function handler(params) {
  return { sent: true, target: params.target };
};
`;

const markerToolJson = {
  name:        'echo_tool',
  description: 'Echo for testing.',
  version:     '1.0.0',
  invocation:  'marker',
  parameters: {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== cascade: empty dirs ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    const reg = cascade.load('alice', tmp, tmp);
    assertEqual(reg.nativeTools.length, 0, 'empty dirs: 0 native tools');
    assertEqual(reg.markerTools.length, 0, 'empty dirs: 0 marker tools');
    assertEqual(reg.all.size, 0, 'empty dirs: map size 0');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: single framework native tool ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    makeTool(tmp, 'leave_message', validToolJson, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    assertEqual(reg.nativeTools.length, 1, 'one native tool loaded');
    assertEqual(reg.nativeTools[0].name, 'leave_message', 'tool name correct');
    assertEqual(reg.nativeTools[0].invocation, 'native', 'invocation native');
    assert(typeof reg.nativeTools[0].handler === 'function', 'handler is function');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: marker tool goes to markerTools ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    makeTool(tmp, 'echo_tool', markerToolJson, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    assertEqual(reg.nativeTools.length, 0, 'no native tools');
    assertEqual(reg.markerTools.length, 1, 'one marker tool');
    assertEqual(reg.markerTools[0].name, 'echo_tool', 'marker tool name correct');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: entity tier overrides framework tier ===');
{
  const frameworkTmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-fw-'));
  const entityBaseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-eb-'));
  try {
    // Framework tool: leave_message with description "framework"
    const fwTool = { ...validToolJson, description: 'framework version' };
    makeTool(frameworkTmp, 'leave_message', fwTool, validHandlerSrc);

    // Entity tool: leave_message with description "entity"
    const entityToolsDir = path.join(entityBaseTmp, '.alice', 'tools');
    fs.mkdirSync(entityToolsDir, { recursive: true });
    const entityTool = { ...validToolJson, description: 'entity version' };
    makeTool(entityToolsDir, 'leave_message', entityTool, validHandlerSrc);

    const reg = cascade.load('alice', entityBaseTmp, frameworkTmp);
    assertEqual(reg.nativeTools.length, 1, 'entity overrides: still 1 tool');
    assertEqual(reg.nativeTools[0].description, 'entity version', 'entity description wins');
  } finally {
    fs.rmSync(frameworkTmp, { recursive: true });
    fs.rmSync(entityBaseTmp, { recursive: true });
  }
}

console.log('\n=== cascade: both tiers, different names ===');
{
  const frameworkTmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-fw-'));
  const entityBaseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-eb-'));
  try {
    // Framework tool
    makeTool(frameworkTmp, 'leave_message', validToolJson, validHandlerSrc);

    // Entity tool (different name)
    const entityToolJson2 = {
      name:        'custom_tool',
      description: 'Custom entity tool.',
      version:     '1.0.0',
      invocation:  'native',
      parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    };
    const entityToolsDir = path.join(entityBaseTmp, '.alice', 'tools');
    fs.mkdirSync(entityToolsDir, { recursive: true });
    makeTool(entityToolsDir, 'custom_tool', entityToolJson2, validHandlerSrc);

    const reg = cascade.load('alice', entityBaseTmp, frameworkTmp);
    assertEqual(reg.nativeTools.length, 2, 'two tools: fw + entity');
    const names = reg.nativeTools.map(t => t.name).sort();
    assertEqual(names[0], 'custom_tool', 'custom_tool present');
    assertEqual(names[1], 'leave_message', 'leave_message present');
  } finally {
    fs.rmSync(frameworkTmp, { recursive: true });
    fs.rmSync(entityBaseTmp, { recursive: true });
  }
}

console.log('\n=== cascade: missing tool.json skipped ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    // Only handler.js, no tool.json
    const toolDir = path.join(tmp, 'bad_tool');
    fs.mkdirSync(toolDir);
    fs.writeFileSync(path.join(toolDir, 'handler.js'), validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    assertEqual(reg.all.size, 0, 'missing tool.json: skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: name mismatch skipped ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    const mismatchTool = { ...validToolJson, name: 'wrong_name' };
    makeTool(tmp, 'leave_message', mismatchTool, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    assertEqual(reg.all.size, 0, 'name mismatch: skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: unsupported schema keyword skipped ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    const badTool = {
      ...validToolJson,
      parameters: {
        type: 'object',
        allOf: [{ type: 'object' }],  // unsupported
        properties: {},
      },
    };
    makeTool(tmp, 'leave_message', badTool, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    assertEqual(reg.all.size, 0, 'allOf in schema: skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: invoke() calls handler ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    const handlerSrc = `
'use strict';
module.exports = async function handler(params, context) {
  return { sent: true, target: params.target, entity: context.entity };
};
`;
    makeTool(tmp, 'leave_message', validToolJson, handlerSrc);
    const reg = cascade.load('alice', null, tmp);

    (async () => {
      try {
        const result = await reg.invoke('leave_message', { target: 'juno', body: 'hello' }, { entity: 'alice' });
        assertEqual(result.sent, true, 'invoke: sent=true');
        assertEqual(result.target, 'juno', 'invoke: target=juno');
        assertEqual(result.entity, 'alice', 'invoke: context.entity passed');
      } catch (e) {
        failed++;
        console.error(`  [FAIL] invoke threw: ${e.message}`);
      }
    })();
  } finally {
    // Cleanup after async test completes (next tick)
    setImmediate(() => fs.rmSync(tmp, { recursive: true }));
  }
}

console.log('\n=== cascade: toAnthropicFormat() ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    makeTool(tmp, 'leave_message', validToolJson, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    const anthropicTools = reg.toAnthropicFormat();
    assertEqual(anthropicTools.length, 1, 'anthropic format: 1 tool');
    assert('input_schema' in anthropicTools[0], 'anthropic format: input_schema key');
    assert('name' in anthropicTools[0], 'anthropic format: name key');
    assert('description' in anthropicTools[0], 'anthropic format: description key');
    assert(!('parameters' in anthropicTools[0]), 'anthropic format: no parameters key (remapped)');
    assertEqual(anthropicTools[0].input_schema, validToolJson.parameters, 'input_schema matches parameters');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

console.log('\n=== cascade: toGroqFormat() ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-harness-test-'));
  try {
    makeTool(tmp, 'leave_message', validToolJson, validHandlerSrc);
    const reg = cascade.load('alice', null, tmp);
    const groqTools = reg.toGroqFormat();
    assertEqual(groqTools.length, 1, 'groq format: 1 tool');
    assertEqual(groqTools[0].type, 'function', 'groq format: type=function');
    assert('function' in groqTools[0], 'groq format: function key');
    assertEqual(groqTools[0].function.parameters, validToolJson.parameters, 'groq format: parameters correct');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

// Give async invoke test a tick to complete
setImmediate(() => {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`tool-cascade: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
