// tool-cascade.js — VESTA-SPEC-137 entity tool cascade loader
//
// Discovers and loads tools from two tiers:
//   Tier 1 (entity): ~/.<entity>/tools/<name>/
//   Tier 2 (framework): ~/.koad-io/packages/harness/tools/<name>/
//
// Entity tools take precedence over framework tools with the same name.
// Each tool directory must contain tool.json + handler.js.
// Invalid tools are logged and skipped — session continues without them.
//
// Returns a tool registry for use by provider normalization and handler dispatch.

const fs   = require('fs');
const path = require('path');
const Module = require('module');
const _nodeRequire = Module.createRequire(process.cwd() + '/package.json');

// Supported JSON Schema top-level keywords for parameters validation.
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  'type', 'description', 'properties', 'required', 'enum',
  'items', 'additionalProperties', 'minimum', 'maximum',
  'minLength', 'maxLength',
]);
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

// Validate the parameters schema follows the supported subset (§4.3).
// Returns null if valid, an error string if invalid.
function _validateSchema(schema, label) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return `${label}: parameters must be a JSON Schema object`;
  }
  if (schema.type !== 'object') {
    return `${label}: parameters.type must be "object"`;
  }

  // Scan for unsupported keywords recursively
  function scanNode(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    for (const key of Object.keys(node)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        return `${label}: unsupported schema keyword "${key}" at ${path}`;
      }
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const [propName, propSchema] of Object.entries(node.properties)) {
        const err = scanNode(propSchema, `${path}.properties.${propName}`);
        if (err) return err;
      }
    }
    if (node.items) {
      const err = scanNode(node.items, `${path}.items`);
      if (err) return err;
    }
    return null;
  }

  return scanNode(schema, 'parameters');
}

// Load a single tool from a directory path.
// Returns { name, description, version, invocation, parameters, handler } or null.
function _loadTool(toolDir) {
  const toolJsonPath = path.join(toolDir, 'tool.json');
  const handlerPath  = path.join(toolDir, 'handler.js');
  const dirName      = path.basename(toolDir);

  // Both files required
  if (!fs.existsSync(toolJsonPath)) {
    console.warn(`[harness:tools] skipping ${dirName} — missing tool.json`);
    return null;
  }
  if (!fs.existsSync(handlerPath)) {
    console.warn(`[harness:tools] skipping ${dirName} — missing handler.js`);
    return null;
  }

  // Parse tool.json
  let def;
  try {
    def = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8'));
  } catch (e) {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json parse error: ${e.message}`);
    return null;
  }

  // Validate required fields
  if (!def.name || typeof def.name !== 'string') {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json missing name`);
    return null;
  }
  if (def.name !== dirName) {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json name "${def.name}" does not match directory name "${dirName}"`);
    return null;
  }
  if (!def.description || typeof def.description !== 'string') {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json missing description`);
    return null;
  }
  if (def.invocation !== 'native' && def.invocation !== 'marker') {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json invocation must be "native" or "marker"`);
    return null;
  }
  if (!def.parameters || typeof def.parameters !== 'object') {
    console.warn(`[harness:tools] skipping ${dirName} — tool.json missing parameters`);
    return null;
  }

  // Validate schema subset
  const schemaErr = _validateSchema(def.parameters, dirName);
  if (schemaErr) {
    console.warn(`[harness:tools] skipping ${dirName} — ${schemaErr}`);
    return null;
  }

  // Load handler
  let handler;
  try {
    handler = _nodeRequire(handlerPath);
  } catch (e) {
    console.warn(`[harness:tools] skipping ${dirName} — handler.js load error: ${e.message}`);
    return null;
  }

  if (typeof handler !== 'function') {
    console.warn(`[harness:tools] skipping ${dirName} — handler.js must export a function`);
    return null;
  }

  return {
    name:        def.name,
    description: def.description,
    version:     def.version || '1.0.0',
    invocation:  def.invocation,
    parameters:  def.parameters,
    handler,
  };
}

// Walk a directory and return all subdirectory names.
// Returns empty array if directory does not exist.
function _listToolDirs(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(name => {
        const full = path.join(dir, name);
        return fs.statSync(full).isDirectory();
      })
      .map(name => path.join(dir, name));
  } catch (e) {
    console.warn(`[harness:tools] error reading tool dir ${dir}: ${e.message}`);
    return [];
  }
}

module.exports = KoadHarnessToolCascade = {

  // load(entity, entityBaseDir, frameworkToolsDir) → toolRegistry
  //
  // entity:          entity handle (e.g. "alice")
  // entityBaseDir:   base dir for entity homes (e.g. "/home/koad")
  //                  entity tools are at <entityBaseDir>/.<entity>/tools/
  // frameworkToolsDir: path to ~/.koad-io/packages/harness/tools/
  //                  (defaults to the tools/ dir adjacent to this file's package)
  //
  // Returns a tool registry object with:
  //   .nativeTools   — array of loaded native tool definitions (for provider registration)
  //   .markerTools   — array of loaded marker tool definitions (for output pipeline)
  //   .all           — Map<name, toolDef> of all loaded tools
  //   .invoke(name, params, context) → Promise<result> — execute a handler by name

  load(entity, entityBaseDir, frameworkToolsDir) {
    if (!frameworkToolsDir) {
      const home = process.env.HOME || '/home/koad';
      frameworkToolsDir = path.join(home, '.koad-io', 'packages', 'harness', 'tools');
    }

    // Tier 1: entity tools
    const entityToolsDir = entityBaseDir
      ? path.join(entityBaseDir, `.${entity}`, 'tools')
      : null;
    const entityDirs    = _listToolDirs(entityToolsDir);

    // Tier 2: framework tools
    const frameworkDirs = _listToolDirs(frameworkToolsDir);

    // Build name → dir map (entity wins on collision)
    const nameToDir = new Map();
    for (const dir of frameworkDirs) {
      nameToDir.set(path.basename(dir), dir);
    }
    for (const dir of entityDirs) {
      // Entity tier overwrites framework tier on same name (§3 cascade)
      nameToDir.set(path.basename(dir), dir);
    }

    // Load each surviving directory
    const nativeTools = [];
    const markerTools = [];
    const all = new Map();

    for (const [name, dir] of nameToDir) {
      const tool = _loadTool(dir);
      if (!tool) continue; // logged inside _loadTool

      all.set(tool.name, tool);
      if (tool.invocation === 'native') {
        nativeTools.push(tool);
      } else {
        markerTools.push(tool);
      }
    }

    const loadedNames = [...all.keys()];
    const nativeNames = nativeTools.map(t => `${t.name}(native)`);
    const markerNames = markerTools.map(t => `${t.name}(marker)`);
    console.log(`[harness:tools] entity=${entity} loaded ${all.size} tool(s): ${[...nativeNames, ...markerNames].join(', ') || 'none'}`);

    return {
      nativeTools,
      markerTools,
      all,

      // invoke(name, params, context) — call a handler by name
      // context = { entity, sessionId, userId, settings }
      // Returns Promise<result>
      async invoke(name, params, context) {
        const tool = all.get(name);
        if (!tool) throw new Error(`tool not found: ${name}`);
        return await tool.handler(params, context || {});
      },

      // toAnthropicFormat() — normalize native tools for Anthropic API
      // Returns array suitable for the "tools" field in the request body.
      toAnthropicFormat() {
        return nativeTools.map(t => ({
          name:         t.name,
          description:  t.description,
          input_schema: t.parameters,
        }));
      },

      // toGroqFormat() — normalize native tools for Groq/OpenAI-compatible API
      toGroqFormat() {
        return nativeTools.map(t => ({
          type: 'function',
          function: {
            name:        t.name,
            description: t.description,
            parameters:  t.parameters,
          },
        }));
      },
    };
  },
};
