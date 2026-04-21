// daemon-tools.js — VESTA-SPEC-139 §6.2 daemon state tools
// 12 typed tools: 7 read, 5 write (tickler.defer is stubbed per OQ-5).
//
// Each tool def: { name, description, parameters, scope, handler(params, profile) }
// handler returns { result } on success, throws on error.

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const HOME         = process.env.HOME || '/home/koad';
const MESSAGES_DIR = path.join(HOME, '.koad-io', 'messages');
const DAEMON_HOST  = '10.10.10.10';
const DAEMON_PORT  = 28282;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// POST to daemon REST endpoint (used by write tools to reuse existing path).
function daemonPost(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: DAEMON_HOST,
      port: DAEMON_PORT,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Scope constants for tools
// ---------------------------------------------------------------------------

const SCOPE = {
  READ_OWN_OR_ALL:     'read.own|read.all',
  READ_KINGDOM:        'read.kingdom.summary',
  WRITE_EMISSIONS_OWN: 'write.emissions.own|write.all',
  WRITE_FLIGHTS_OWN:   'write.flights.own|write.all',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const daemonTools = [

  // -------------------------------------------------------------------------
  // READ TOOLS
  // -------------------------------------------------------------------------

  {
    name: 'daemon.emissions.active',
    description: 'Returns active lifecycle emissions (open or active status). Without entity param, returns caller\'s own active emissions. With entity param, requires read.all scope.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity handle to query. Omit to query own emissions. Requires read.all scope if provided.',
        },
        limit: {
          type: 'integer',
          description: 'Max results. Default 20, max 100.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_OWN_OR_ALL,
    async handler(params, profile) {
      const { entity: callerEntity, scopes } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkReadAccess(profile, params.entity ? targetEntity : null, false);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const Emissions = globalThis.EmissionsCollection;
      if (!Emissions) throw new Error('EmissionsCollection not available');

      const selector = { status: { $in: ['open', 'active'] } };
      // If no read.all, restrict to own entity
      if (!auth.hasScope(scopes, 'read.all')) {
        selector.entity = callerEntity;
      } else if (params.entity) {
        selector.entity = targetEntity;
      }

      const limit = Math.min(params.limit || 20, 100);
      const emissions = await Emissions.find(selector, {
        sort: { startedAt: -1 },
        limit,
      }).fetchAsync();

      return { count: emissions.length, emissions };
    },
  },

  {
    name: 'daemon.flights.by_entity',
    description: 'Returns recent flights. Without entity param, returns caller\'s own flights. With entity param, requires read.all scope.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity handle. Omit for own flights. Requires read.all if specified.',
        },
        status: {
          type: 'string',
          enum: ['flying', 'landed', 'stale'],
          description: 'Filter by flight status.',
        },
        limit: {
          type: 'integer',
          description: 'Max results. Default 20, max 100.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_OWN_OR_ALL,
    async handler(params, profile) {
      const { entity: callerEntity, scopes } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkReadAccess(profile, params.entity ? targetEntity : null, false);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const Flights = globalThis.FlightsCollection;
      if (!Flights) throw new Error('FlightsCollection not available');

      const selector = {};
      if (!auth.hasScope(scopes, 'read.all')) {
        selector.entity = callerEntity;
      } else if (params.entity) {
        selector.entity = targetEntity;
      }
      if (params.status) selector.status = params.status;

      const limit = Math.min(params.limit || 20, 100);
      const flights = await Flights.find(selector, {
        sort: { started: -1 },
        limit,
      }).fetchAsync();

      return { count: flights.length, flights };
    },
  },

  {
    name: 'daemon.messages.count',
    description: 'Returns unread message count for an entity\'s inbox. Without entity param, queries caller\'s own inbox.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity handle. Omit for own inbox. Requires read.all scope if provided.',
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_OWN_OR_ALL,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;

      const check = auth.checkReadAccess(profile, params.entity || null, false);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const targetEntity = params.entity || callerEntity;
      const entityDir = path.join(MESSAGES_DIR, targetEntity);

      let count = 0;
      try {
        const files = fs.readdirSync(entityDir);
        count = files.filter(f => f !== 'processed' && f.endsWith('.md')).length;
      } catch (e) {
        // Directory doesn't exist = 0 messages
      }

      return { entity: targetEntity, count };
    },
  },

  {
    name: 'daemon.tickler.due',
    description: 'Returns pending tickler items for an entity. The tickler stores filenames in ~/.<entity>/tickler/ — items whose names begin with a date <= today are considered due.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity handle. Omit for own tickler. Requires read.all scope if provided.',
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_OWN_OR_ALL,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;

      const check = auth.checkReadAccess(profile, params.entity || null, false);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const targetEntity = params.entity || callerEntity;

      // TicklerIndex stores { handle, tickles: [filename], count }
      const TicklerRef = new Mongo.Collection('TicklerIndex', { connection: null });
      const record = await TicklerRef.findOneAsync({ handle: targetEntity });

      if (!record) return { entity: targetEntity, count: 0, items: [] };

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

      // Items whose filename begins with a date prefix <= today are due.
      // Tickler files are typically named YYYY-MM-DD-subject.md or YYYYMMDD-subject.md.
      const dueItems = (record.tickles || []).filter(filename => {
        const base = path.basename(filename);
        // Try YYYY-MM-DD prefix
        const isoMatch = base.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          const fileDate = isoMatch[1] + isoMatch[2] + isoMatch[3];
          return fileDate <= todayStr;
        }
        // Try YYYYMMDD prefix
        const compactMatch = base.match(/^(\d{8})/);
        if (compactMatch) {
          return compactMatch[1] <= todayStr;
        }
        // No date prefix — treat as past due (include it)
        return true;
      });

      return { entity: targetEntity, count: dueItems.length, items: dueItems };
    },
  },

  {
    name: 'daemon.sessions.active',
    description: 'Returns active harness sessions. With read.kingdom.summary scope, returns count and entity list only. With read.all scope, returns full session records including cost and context size.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Filter to one entity. Requires read.all if entity is not the caller.',
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_KINGDOM,
    async handler(params, profile) {
      const { entity: callerEntity, scopes } = profile;
      const auth = globalThis.McpServiceAuth;

      const fullRecords = auth.hasScope(scopes, 'read.all') ||
                          (auth.hasScope(scopes, 'read.own') && (!params.entity || params.entity === callerEntity));

      const check = auth.checkSessionRead(profile, params.entity || null, fullRecords);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const Sessions = globalThis.SessionsCollection;
      if (!Sessions) throw new Error('SessionsCollection not available');

      const selector = { status: 'active' };
      if (params.entity) {
        // If not read.all and entity isn't caller — already blocked by checkSessionRead
        selector.entity = params.entity;
      } else if (!auth.hasScope(scopes, 'read.all')) {
        selector.entity = callerEntity;
      }

      const sessions = await Sessions.find(selector, {
        sort: { lastSeen: -1 },
        limit: 200,
      }).fetchAsync();

      if (fullRecords) {
        const totalCost = sessions.reduce((sum, s) => sum + (s.cost || 0), 0);
        return { count: sessions.length, totalCost, sessions };
      } else {
        // Summary only
        const entities = [...new Set(sessions.map(s => s.entity))];
        return { count: sessions.length, entities };
      }
    },
  },

  {
    name: 'daemon.kingdoms.list',
    description: 'Returns all kingdoms indexed by this daemon instance.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    minScope: SCOPE.READ_KINGDOM,
    async handler(params, profile) {
      const auth = globalThis.McpServiceAuth;
      const check = auth.checkKingdomSummaryRead(profile);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const KingdomsRef = new Mongo.Collection('Kingdoms', { connection: null });
      const kingdoms = await KingdomsRef.find({}, { sort: { name: 1 } }).fetchAsync();

      return {
        count: kingdoms.length,
        kingdoms: kingdoms.map(k => ({
          _id: k._id,
          name: k.name || null,
          handle: k.handle || null,
          sovereign: k.sovereign || null,
        })),
      };
    },
  },

  {
    name: 'daemon.entities.list',
    description: 'Returns the entity index — all entities this daemon knows about, summary fields only.',
    parameters: {
      type: 'object',
      properties: {
        kingdom: {
          type: 'string',
          description: 'Filter by kingdom handle.',
        },
      },
      required: [],
    },
    minScope: SCOPE.READ_KINGDOM,
    async handler(params, profile) {
      const auth = globalThis.McpServiceAuth;
      const check = auth.checkKingdomSummaryRead(profile);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const selector = {};
      if (params.kingdom) selector.kingdomId = params.kingdom;

      const entities = await EntityScanner.Entities.find(
        selector,
        { fields: { handle: 1, role: 1, lastActivity: 1, kingdomId: 1 }, sort: { handle: 1 } }
      ).fetchAsync();

      return {
        count: entities.length,
        entities: entities.map(e => ({
          handle: e.handle,
          role: e.role || null,
          lastActivity: e.lastActivity ? e.lastActivity.toISOString() : null,
          kingdomId: e.kingdomId || null,
        })),
      };
    },
  },

  // -------------------------------------------------------------------------
  // WRITE TOOLS
  // -------------------------------------------------------------------------

  {
    name: 'daemon.emission.open',
    description: 'Opens a new lifecycle emission. Signals the beginning of a unit of work. Use to emit an open-state notice visible in active emissions.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity to emit for. Defaults to authenticated entity. Requires write.all to emit for another entity.',
        },
        type: {
          type: 'string',
          enum: ['notice', 'warning', 'error', 'request', 'session', 'flight', 'service', 'conversation', 'hook'],
          description: 'Emission type.',
        },
        body: {
          type: 'string',
          description: 'Human-readable status message for this emission.',
        },
        meta: {
          type: 'object',
          description: 'Optional metadata. Key-value pairs.',
          additionalProperties: true,
        },
      },
      required: ['type', 'body'],
    },
    minScope: SCOPE.WRITE_EMISSIONS_OWN,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkEmissionWrite(profile, params.entity ? targetEntity : null);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const result = await daemonPost('/emit', {
        entity: targetEntity,
        type: params.type,
        body: params.body,
        lifecycle: 'open',
        meta: params.meta || {},
      });

      return { _id: result._id, status: 'open' };
    },
  },

  {
    name: 'daemon.emission.update',
    description: 'Updates an open lifecycle emission with new body text and optional metadata.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The emission _id to update.',
        },
        body: {
          type: 'string',
          description: 'Updated status message.',
        },
        meta: {
          type: 'object',
          description: 'Optional metadata to merge into existing meta.',
          additionalProperties: true,
        },
      },
      required: ['id', 'body'],
    },
    minScope: SCOPE.WRITE_EMISSIONS_OWN,
    async handler(params, profile) {
      const auth = globalThis.McpServiceAuth;

      // Verify the emission belongs to this entity (unless write.all)
      const Emissions = globalThis.EmissionsCollection;
      if (!Emissions) throw new Error('EmissionsCollection not available');

      const emission = await Emissions.findOneAsync(params.id);
      if (!emission) throw new Error(`Emission ${params.id} not found`);

      const check = auth.checkEmissionWrite(profile, emission.entity);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const result = await daemonPost('/emit/update', {
        _id: params.id,
        body: params.body,
        meta: params.meta || undefined,
      });

      return { _id: params.id, status: 'active' };
    },
  },

  {
    name: 'daemon.emission.close',
    description: 'Closes a lifecycle emission. The emission moves to closed state and is no longer active.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The emission _id to close.',
        },
        body: {
          type: 'string',
          description: 'Final status message.',
        },
      },
      required: ['id', 'body'],
    },
    minScope: SCOPE.WRITE_EMISSIONS_OWN,
    async handler(params, profile) {
      const auth = globalThis.McpServiceAuth;

      const Emissions = globalThis.EmissionsCollection;
      if (!Emissions) throw new Error('EmissionsCollection not available');

      const emission = await Emissions.findOneAsync(params.id);
      if (!emission) throw new Error(`Emission ${params.id} not found`);

      const check = auth.checkEmissionWrite(profile, emission.entity);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      await daemonPost('/emit/update', {
        _id: params.id,
        body: params.body,
        action: 'close',
      });

      return { _id: params.id, status: 'closed' };
    },
  },

  {
    name: 'daemon.flight.open',
    description: 'Opens a flight record in the daemon. Signals the beginning of a dispatch or significant operation.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The flight ID (caller-supplied, must be globally unique — use a timestamp-slug pattern).',
        },
        entity: {
          type: 'string',
          description: 'Entity for this flight. Defaults to authenticated entity.',
        },
        brief_slug: {
          type: 'string',
          description: 'Brief slug or task identifier.',
        },
        brief_summary: {
          type: 'string',
          description: 'Short summary of the task (max 300 chars).',
        },
        model: {
          type: 'string',
          description: 'Model identifier used for this flight.',
        },
      },
      required: ['id'],
    },
    minScope: SCOPE.WRITE_FLIGHTS_OWN,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkFlightWrite(profile, params.entity ? targetEntity : null);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      await daemonPost('/flight', {
        action: 'open',
        _id: params.id,
        entity: targetEntity,
        briefSlug: params.brief_slug || '',
        briefSummary: params.brief_summary ? String(params.brief_summary).slice(0, 300) : '',
        model: params.model || '',
        started: new Date().toISOString(),
      });

      return { _id: params.id, status: 'flying' };
    },
  },

  {
    name: 'daemon.flight.close',
    description: 'Closes a flight record. Signals completion of a dispatch.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The flight ID to close.',
        },
        summary: {
          type: 'string',
          description: 'Completion summary (max 300 chars).',
        },
        stats: {
          type: 'object',
          description: 'Optional stats: { toolCalls, contextTokens, inputTokens, outputTokens, cost }',
          additionalProperties: true,
        },
      },
      required: ['id'],
    },
    minScope: SCOPE.WRITE_FLIGHTS_OWN,
    async handler(params, profile) {
      const auth = globalThis.McpServiceAuth;

      // Verify ownership (unless write.all)
      const Flights = globalThis.FlightsCollection;
      if (!Flights) throw new Error('FlightsCollection not available');

      const flight = await Flights.findOneAsync({ _id: params.id });
      if (!flight) throw new Error(`Flight ${params.id} not found`);

      const check = auth.checkFlightWrite(profile, flight.entity);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      const payload = {
        action: 'close',
        _id: params.id,
        ended: new Date().toISOString(),
      };
      if (params.summary) payload.completionSummary = params.summary;
      if (params.stats)   payload.stats = params.stats;

      await daemonPost('/flight', payload);

      return { _id: params.id, status: 'landed' };
    },
  },

  {
    name: 'daemon.tickler.defer',
    description: 'Creates a tickler entry — a deferred reminder for an entity. NOTE: The daemon tickler system is read-only (file scan only) in the current implementation. This tool writes a tickler markdown file to ~/.<entity>/tickler/ directly.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity to tickle. Defaults to authenticated entity.',
        },
        subject: {
          type: 'string',
          description: 'What to be reminded about.',
        },
        due_at: {
          type: 'string',
          description: 'ISO 8601 datetime when this tickler fires.',
        },
        meta: {
          type: 'object',
          description: 'Optional context.',
          additionalProperties: true,
        },
      },
      required: ['subject', 'due_at'],
    },
    minScope: SCOPE.WRITE_EMISSIONS_OWN,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkEmissionWrite(profile, params.entity ? targetEntity : null);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      // OQ-5: The daemon has no tickler write REST endpoint.
      // Write the tickler file directly to ~/.<entity>/tickler/
      // The tickler indexer will pick it up on next scan.
      const entityPath = path.join(HOME, `.${targetEntity}`);
      const ticklerDir = path.join(entityPath, 'tickler');

      try {
        if (!fs.existsSync(ticklerDir)) {
          fs.mkdirSync(ticklerDir, { recursive: true });
        }

        // Parse due_at for filename prefix
        const dueDate = new Date(params.due_at);
        if (isNaN(dueDate.getTime())) {
          throw new Error(`Invalid due_at date: ${params.due_at}`);
        }

        const dateStr = dueDate.toISOString().slice(0, 10); // YYYY-MM-DD
        const slug = params.subject
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60);
        const filename = `${dateStr}-${slug}.md`;
        const filepath = path.join(ticklerDir, filename);

        const id = `${targetEntity}-${Date.now()}`;

        const lines = [
          '---',
          `entity: ${targetEntity}`,
          `subject: ${params.subject}`,
          `due_at: ${dueDate.toISOString()}`,
          `created_at: ${new Date().toISOString()}`,
        ];
        if (params.meta) {
          lines.push(`meta: '${JSON.stringify(params.meta).replace(/'/g, "''")}'`);
        }
        lines.push('---', '', `# ${params.subject}`, '', `Due: ${dueDate.toISOString()}`, '');

        fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
        console.log(`[mcp-service:tickler] wrote ${targetEntity}/tickler/${filename}`);

        return { _id: id, entity: targetEntity, subject: params.subject, due_at: dueDate.toISOString(), filename };
      } catch (e) {
        if (e.mcpError) throw e;
        throw new Error(`tickler.defer failed: ${e.message}`);
      }
    },
  },

  {
    name: 'daemon.message.drop',
    description: 'Drops (deletes) a message file from an entity\'s inbox. Use after the entity has acknowledged and processed the message.',
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description: 'Entity whose inbox contains the message. Defaults to authenticated entity.',
        },
        filename: {
          type: 'string',
          description: 'Filename in the entity\'s inbox directory to delete. Must be a plain filename (no path separators).',
        },
      },
      required: ['filename'],
    },
    minScope: SCOPE.WRITE_EMISSIONS_OWN,
    async handler(params, profile) {
      const { entity: callerEntity } = profile;
      const auth = globalThis.McpServiceAuth;
      const targetEntity = params.entity || callerEntity;

      const check = auth.checkEmissionWrite(profile, params.entity ? targetEntity : null);
      if (!check.ok) throw { mcpError: check.error, message: check.message };

      // Safety: reject filenames with path separators
      if (!params.filename || params.filename.includes('/') || params.filename.includes('..')) {
        throw new Error('Invalid filename: path separators not allowed');
      }

      const filepath = path.join(MESSAGES_DIR, targetEntity, params.filename);

      try {
        fs.unlinkSync(filepath);
        console.log(`[mcp-service:messages] dropped ${targetEntity}/${params.filename}`);
        return { deleted: true, filename: params.filename };
      } catch (e) {
        if (e.code === 'ENOENT') {
          return { deleted: false, error: 'File not found' };
        }
        throw new Error(`Failed to delete message: ${e.message}`);
      }
    },
  },
];

globalThis.McpDaemonTools = daemonTools;
