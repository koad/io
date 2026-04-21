// tool-loader.js — VESTA-SPEC-137 cascade loader for MCP sessions
// Walks entity tools (tier 1) and framework tools (tier 2).
// Entity tools override framework tools on name collision.
// Entity tools named 'daemon.*' are rejected per §6.3.
//
// Returns an array of { name, description, parameters, handler } for MCP registration.

'use strict';

const fs     = require('fs');
const path   = require('path');
const Module = require('module');

// Build a node require that can load handler.js files from arbitrary paths.
// Use process.cwd() as anchor; handler files are CommonJS modules.
let _nodeRequire;
try {
  _nodeRequire = Module.createRequire(process.cwd() + '/package.json');
} catch (e) {
  _nodeRequire = require;
}

const FRAMEWORK_TOOLS_DIR = path.join(
  process.env.HOME || '/home/koad',
  '.koad-io', 'packages', 'harness', 'tools'
);

// Validate parameters schema — same rules as tool-cascade.js (VESTA-SPEC-137 §4.3)
const UNSUPPORTED_KEYWORDS = new Set([
  '$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

function _validateSchema(schema, label) {
  if (!schema || typeof schema !== 'object') return `${label}: parameters must be an object`;
  if (schema.type !== 'object') return `${label}: parameters.type must be "object"`;

  function scan(node, nodePath) {
    if (!node || typeof node !== 'object') return null;
    for (const key of Object.keys(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) return `${label}: unsupported keyword "${key}" at ${nodePath}`;
    }
    if (node.properties) {
      for (const [k, v] of Object.entries(node.properties)) {
        const err = scan(v, `${nodePath}.properties.${k}`);
        if (err) return err;
      }
    }
    if (node.items) {
      const err = scan(node.items, `${nodePath}.items`);
      if (err) return err;
    }
    return null;
  }

  return scan(schema, 'parameters');
}

// Load a single tool directory. Returns null on any failure.
function _loadTool(toolDir) {
  const dirName = path.basename(toolDir);
  const toolJsonPath = path.join(toolDir, 'tool.json');
  const handlerPath  = path.join(toolDir, 'handler.js');

  if (!fs.existsSync(toolJsonPath) || !fs.existsSync(handlerPath)) return null;

  let def;
  try {
    def = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8'));
  } catch (e) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — tool.json parse error: ${e.message}`);
    return null;
  }

  // Name must match dir name
  if (!def.name || def.name !== dirName) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — name mismatch or missing`);
    return null;
  }

  // Reject daemon.* entity tools (§6.3)
  if (def.name.startsWith('daemon.')) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — entity tools may not use daemon. prefix`);
    return null;
  }

  if (!def.description) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — missing description`);
    return null;
  }

  const schemaErr = _validateSchema(def.parameters, dirName);
  if (schemaErr) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — ${schemaErr}`);
    return null;
  }

  let handler;
  try {
    handler = _nodeRequire(handlerPath);
  } catch (e) {
    console.warn(`[mcp-service:loader] skipping ${dirName} — handler.js error: ${e.message}`);
    return null;
  }

  if (typeof handler !== 'function') {
    console.warn(`[mcp-service:loader] skipping ${dirName} — handler.js must export a function`);
    return null;
  }

  return {
    name:        def.name,
    description: def.description,
    parameters:  def.parameters,
    handler,
  };
}

function _listDirs(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .filter(p => fs.statSync(p).isDirectory());
  } catch (e) {
    return [];
  }
}

// loadEntityTools(entity) — walk VESTA-SPEC-137 cascade for entity.
// Returns an array of MCP-ready tool defs: { name, description, parameters, handler }.
function loadEntityTools(entity) {
  const home = process.env.HOME || '/home/koad';
  const entityToolsDir = path.join(home, `.${entity}`, 'tools');

  const entityDirs    = _listDirs(entityToolsDir);
  const frameworkDirs = _listDirs(FRAMEWORK_TOOLS_DIR);

  // Build name → dir (entity wins on collision)
  const nameToDir = new Map();
  for (const dir of frameworkDirs) nameToDir.set(path.basename(dir), dir);
  for (const dir of entityDirs)    nameToDir.set(path.basename(dir), dir); // entity overwrites

  const tools = [];
  for (const [, dir] of nameToDir) {
    const tool = _loadTool(dir);
    if (tool) tools.push(tool);
  }

  console.log(`[mcp-service:loader] entity=${entity} loaded ${tools.length} cascade tool(s): ${tools.map(t => t.name).join(', ') || 'none'}`);
  return tools;
}

globalThis.McpServiceToolLoader = { loadEntityTools };
