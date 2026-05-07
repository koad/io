---
doc-debt: complete
doc-audience: developer
doc-updated: 2026-05-07
doc-maintainer: livy
title: "Sovereign Service Pattern — Building Standalone MCP Services"
type: tutorial
relates-to:
  - /home/koad/.forge/dance-hall/src/README.md
  - /home/koad/.forge/dance-hall/src/mcp/README.md
  - /home/koad/.forge/dance-hall/.koad-io-index.yaml
  - /home/koad/.forge/dance-hall/src/state/jsonl.js
  - /home/koad/.koad-io/training/pluggable-indexers/index.md
  - /home/koad/.koad-io/training/cascade/index.md
entities:
  - livy
audience: developers building new kingdom services
---

# Sovereign Service Pattern

Dance-hall is the reference implementation. It is a pure Node ES-module HTTP server with no Mongo, no Meteor, and no framework beyond Express. State lives in JSONL files; entities and AI tools reach it through MCP. The daemon projects its data through DDP for browser consumers.

This document extracts that pattern and shows how to apply it to a new service.

**What you need to replicate it:**

- A directory for your service (`~/.servicename/` or `~/.forge/servicename/`)
- A `package.json` with a minimal dependency set
- A `src/` directory with five structural concerns: boot, state stores, REST routes, daemon integration, and MCP layer
- A `.koad-io-index.yaml` that makes your data visible to the daemon

The walkthrough builds a concrete hypothetical service — a vote ledger — to show each piece in context. It is not a skeleton to copy; it is a worked example that makes the abstractions tangible.

---

## What the pattern is (and is not)

The sovereign service pattern is for services that:

- Produce structured data that the kingdom needs to track persistently
- Need to be reachable by entities and AI tools via MCP
- Need to project their state into the daemon's live data graph
- Should survive daemon restarts without losing state

It is **not** the right pattern for:

- Commands that run and exit (use `command.sh` in `~/.koad-io/commands/` or `~/.forge/commands/`)
- Data that only needs to exist in Mongo (use the storefront's Meteor collections directly)
- One-off scripts (write a bash command)

The pattern addresses a specific problem: how does a long-running service with its own state participate in the kingdom's reactive data graph without coupling itself to Meteor?

---

## The five structural concerns

Every service built on this pattern has five concerns:

```
src/
  index.js          boot: env, express, route mounts, daemon DDP connect
  state/
    jsonl.js        primitive: append / readAll / readCurrent / archiveTo
    vote-store.js   store: your domain state, built on jsonl primitives
  api/
    votes.js        REST: write endpoints (POST) and read endpoints (GET)
  streams/
    daemon-ddp.js   read path: subscribe to daemon's indexed.* publications
    daemon-write.js write path: POST to daemon /emit and /flight endpoints
  mcp/
    server.js       MCP: Express router, session management, tool list
    auth.js         auth: Bearer token + mesh bypass (VESTA-SPEC-139)
    vote-tools.js   tools: MCP tool handlers for your domain
```

The `mcp/` layer and its auth can be omitted for services that only need REST + daemon projection. Add it when entities or AI tools need to reach the service programmatically.

---

## Step 1 — Boot

`src/index.js` is the entry point. It does four things, in order:

```js
// src/index.js
import express from 'express';
import { loadFromDisk } from './state/vote-store.js';
import { mountVotes } from './api/votes.js';
import { mountMcp } from './mcp/server.js';
import { connectDaemonDdp } from './streams/daemon-ddp.js';

const app = express();
app.use(express.json());

// 1. Restore in-memory state from disk
await loadFromDisk();

// 2. Mount REST routes
mountVotes(app);
mountMcp(app);

// 3. Start listening (mesh address only)
const BIND_IP = process.env.KOAD_IO_BIND_IP || '10.10.10.10';
const PORT = process.env.PORT || 28391;
app.listen(PORT, BIND_IP, () => {
  console.log(`[vote-ledger] listening on ${BIND_IP}:${PORT}`);
});

// 4. Connect to daemon for DDP read path
connectDaemonDdp();
```

**The mesh binding is not optional.** Dance-hall, and every sovereign service, binds to the ZeroTier/Netbird mesh IP (`10.10.10.10` by default). The mesh is the trust perimeter. A service bound to `0.0.0.0` is exposed to the open internet; a service bound to the mesh IP is reachable only by entities inside the perimeter.

**`KOAD_IO_BIND_IP` is the override.** Pick it up from the environment cascade; don't hardcode `10.10.10.10`. When running locally without a mesh interface, you can set it to `127.0.0.1`.

**`loadFromDisk()` runs before routes are mounted.** The in-memory state must be ready before the first request arrives. The boot sequence is synchronous on this point.

---

## Step 2 — State: JSONL primitives

The canonical JSONL primitive module is four functions. Copy it verbatim or import it from a shared location:

```js
// src/state/jsonl.js
import fs from 'fs';
import path from 'path';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function append(filePath, record) {
  ensureDir(path.dirname(filePath));
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

export function readAll(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function readCurrent(filePath) {
  const all = readAll(filePath);
  return all.length > 0 ? all[all.length - 1] : null;
}

export function archiveTo(filePath, archivePath) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(path.dirname(archivePath));
  const content = fs.readFileSync(filePath, 'utf8');
  fs.appendFileSync(archivePath, content, 'utf8');
  fs.writeFileSync(filePath, '', 'utf8');
}
```

These are synchronous. The file is opened, written, and closed on every call. There is no connection, no pool, no transaction. This is intentional: the file is the ledger, and a ledger that can be read with `cat` is a ledger you can trust.

**What each primitive is for:**

| Primitive | Use for |
|-----------|---------|
| `append` | Every write — votes, events, receipts |
| `readAll` | Rebuilding in-memory state at boot; reading a full log |
| `readCurrent` | Single-record state — current announcement, latest status |
| `archiveTo` | Cycling state — move current record into an archive log on update |

---

## Step 3 — State: domain store

The domain store owns your service's in-memory model. It is the only layer that reads and writes JSONL. Everything above it calls store functions.

```js
// src/state/vote-store.js
import path from 'path';
import os from 'os';
import { append, readAll } from './jsonl.js';

// Default data dir — override with VOTE_LEDGER_DATA_DIR
const DATA_DIR = process.env.VOTE_LEDGER_DATA_DIR
  || path.join(os.homedir(), '.forge', 'vote-ledger', 'data');

const VOTES_FILE = path.join(DATA_DIR, 'votes.jsonl');

// In-memory index: topic → { yes: N, no: N, votes: Map<entity, vote> }
const _tallies = new Map();

export async function loadFromDisk() {
  const records = readAll(VOTES_FILE);
  for (const r of records) {
    _applyVote(r);
  }
  console.log(`[vote-store] loaded ${records.length} vote records`);
}

export function castVote({ entity, topic, vote, ts }) {
  if (!entity) throw new Error('entity required');
  if (!topic)  throw new Error('topic required');
  if (!['yes', 'no'].includes(vote)) throw new Error('vote must be yes or no');

  const record = {
    _id: `vote-${Date.now()}`,
    entity,
    topic,
    vote,
    ts: ts || new Date().toISOString(),
  };

  // Write to disk first; update memory after confirmed write
  append(VOTES_FILE, record);
  _applyVote(record);
  return record;
}

export function tallyFor(topic) {
  return _tallies.get(topic) || { yes: 0, no: 0, total: 0 };
}

export function recentVotes(limit = 20) {
  const all = readAll(VOTES_FILE);
  return all.slice(-Math.min(limit, 100)).reverse();
}

function _applyVote({ entity, topic, vote }) {
  if (!_tallies.has(topic)) {
    _tallies.set(topic, { yes: 0, no: 0, total: 0, voters: new Map() });
  }
  const t = _tallies.get(topic);
  const previous = t.voters.get(entity);
  if (previous) t[previous]--;   // remove previous vote from tally
  t.voters.set(entity, vote);
  t[vote]++;
  t.total = t.yes + t.no;
}
```

**Write to disk, then update memory.** The file is the source of truth. If the memory update fails after the disk write, a restart will rebuild correctly from disk. The reverse order — memory first, disk second — creates a window where an in-flight request returns data that a restart won't reproduce.

**`loadFromDisk()` replays the full log.** The in-memory tally is rebuilt by replaying every historical vote. This means `_applyVote` must be idempotent with respect to the file — which it is, because it handles overwrites (an entity voting twice on the same topic updates their previous vote).

**`DATA_DIR` is configurable.** Let the operator override the data directory via environment variable. This is the one place you should read from `process.env` directly in the store — the cascade already sourced `.env` files before Node started.

---

## Step 4 — REST routes

REST routes are the write path for callers inside the mesh. They are not auth-protected at the HTTP level — the mesh binding IS the trust perimeter.

```js
// src/api/votes.js
import { castVote, tallyFor, recentVotes } from '../state/vote-store.js';

export function mountVotes(app) {
  // Write: cast a vote
  app.post('/api/votes/cast', (req, res) => {
    const { entity, topic, vote } = req.body || {};
    try {
      const record = castVote({ entity, topic, vote });
      res.json(record);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Read: tally for a topic
  app.get('/api/votes/tally/:topic', (req, res) => {
    const tally = tallyFor(req.params.topic);
    res.json({ topic: req.params.topic, ...tally });
  });

  // Read: recent votes
  app.get('/api/votes/recent', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    res.json({ votes: recentVotes(limit) });
  });
}
```

Keep routes thin. The route handler validates input, calls the store, and returns. No business logic in the route. Error handling catches store exceptions and maps them to appropriate HTTP status codes (400 for caller error, 500 for unexpected).

**What "no auth at HTTP level" actually means:**

The REST API is inside the mesh. Only processes running on the same ZeroTier/Netbird network can reach it. That network requires a cryptographic key to join. This is structural trust — the mesh IS the auth perimeter for REST.

The MCP layer adds per-entity auth on top of this for cases where you need to know WHICH entity is calling and constrain what it can do. REST callers are trusted; MCP callers are identified.

---

## Step 5 — Daemon projection

The `.koad-io-index.yaml` file tells the daemon to watch your JSONL files and project them into live DDP publications. Drop it in the root of your service directory.

```yaml
# ~/.forge/vote-ledger/.koad-io-index.yaml
entity: vote-ledger

indexers:
  - name: vote-ledger-votes
    source: data/votes.jsonl
    collection: VoteLedgerVotes
    format: jsonl
    mode: append-only

  - name: vote-ledger-tallies
    source: data/tallies.jsonl   # optional — if you write a snapshot
    collection: VoteLedgerTallies
    format: jsonl
    mode: current-per-key
    key: topic
```

For the vote ledger, `append-only` is the right mode for the raw vote log — every vote is a distinct record, nothing supersedes anything. If you also write a tally snapshot file (one record per topic, updated on each cast), `current-per-key` with `key: topic` keeps only the latest tally per topic in the daemon collection.

Trigger the daemon to pick up the new file:

```bash
curl -X POST http://10.10.10.10:28282/api/indexers/reload
```

After that, any Meteor consumer on the mesh can subscribe:

```js
// In storefront server code:
import { _daemon } from 'meteor/koad:io-bridge';
const VoteLedgerVotes = new Mongo.Collection('VoteLedgerVotes', { connection: _daemon });
_daemon.subscribe('indexed.VoteLedgerVotes');
Meteor.publish(null, () => VoteLedgerVotes.find());
```

The full walkthrough for this step is in [The Pluggable Indexer — Getting Started](../pluggable-indexers/index.md). That tutorial covers both subscription paths (direct daemon subscribe and via the bridge), the live update loop, and common confusion points.

---

## Step 6 — MCP layer

The MCP layer is what makes your service reachable by entities and AI tools. It wraps your domain state in tool calls that have names, descriptions, and JSON schemas — the interface an LLM can reason about.

### The session pattern

```js
// src/mcp/server.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { resolveProfile } from './auth.js';
import { voteTools } from './vote-tools.js';

// In-memory session registry
const _sessions = new Map();  // sessionId → { transport, server }

export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    // Existing session — route to its transport
    if (sessionId && _sessions.has(sessionId)) {
      const { transport } = _sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — auth, build server, register
    const profile = await resolveProfile(req);
    const server = buildMcpServer(profile);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () =>
      `mcp-${Math.random().toString(16).slice(2, 18)}`
    });

    await server.connect(transport);
    _sessions.set(transport.sessionId, { transport, server });

    transport.onclose = () => _sessions.delete(transport.sessionId);

    await transport.handleRequest(req, res, req.body);
  });
}

function buildMcpServer(profile) {
  const server = new McpServer({ name: 'vote-ledger', version: '0.1.0' });
  for (const tool of voteTools(profile)) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }
  return server;
}
```

### Auth: two paths to a profile

```js
// src/mcp/auth.js
import fs from 'fs';
import path from 'path';
import os from 'os';

// Scan all entity session files for a token match
function scanEntitySessions(token) {
  const home = os.homedir();
  const dirs = fs.readdirSync(home)
    .filter(d => d.startsWith('.') && d.length > 1)
    .map(d => path.join(home, d, '.local', 'state', 'harness', 'sessions'));

  for (const dir of dirs) {
    const file = path.join(dir, `${token}.json`);
    if (fs.existsSync(file)) {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    }
  }
  return null;
}

export async function resolveProfile(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    const profile = scanEntitySessions(token);
    if (!profile) {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    }
    return { ...profile, origin: 'bearer' };
  }

  // No token — mesh bypass (caller must be inside the ZT perimeter)
  return { origin: 'mesh', scopes: ['*'] };
}
```

The two auth paths map to two caller types:

**Bearer token callers** are entities with a harness session. The harness writes a session JSON file to `~/.<entity>/.local/state/harness/sessions/<token>.json`. The auth module scans all entity dirs for a match. A hit returns the entity's profile; a miss returns 401.

**Mesh bypass callers** send no Authorization header. The service trusts them because the mesh binding prevents non-mesh callers from reaching the endpoint at all. This is how Juno calls services without a token when running on the same machine.

For a real service, add scope enforcement after resolving the profile. See `~/.forge/dance-hall/src/mcp/auth.js` for the full bond-type → scope-set resolution logic.

### Writing a tool

```js
// src/mcp/vote-tools.js
import { z } from 'zod';
import { castVote, tallyFor } from '../state/vote-store.js';

export function voteTools(profile) {
  return [
    {
      name: 'cast_vote',
      description: 'Cast a yes/no vote on a topic. Each entity can change their vote; the tally updates immediately.',
      schema: {
        entity: z.string().describe('The entity casting the vote'),
        topic:  z.string().describe('The topic to vote on'),
        vote:   z.enum(['yes', 'no']).describe('The vote value'),
      },
      handler: async ({ entity, topic, vote }) => {
        const record = castVote({ entity, topic, vote });
        return { content: [{ type: 'text', text: JSON.stringify(record, null, 2) }] };
      },
    },
    {
      name: 'get_tally',
      description: 'Get the current vote tally for a topic.',
      schema: {
        topic: z.string().describe('The topic to tally'),
      },
      handler: async ({ topic }) => {
        const tally = tallyFor(topic);
        return { content: [{ type: 'text', text: JSON.stringify({ topic, ...tally }, null, 2) }] };
      },
    },
  ];
}
```

Tool handlers receive the JSON-parsed arguments from the MCP client. They return a `content` array with at least one item. For tools that produce structured data, return it as a `text` item with JSON-stringified content — this is what Juno reads.

The `profile` argument gives the tool access to the calling entity's identity if you need to enforce per-entity constraints inside the handler. For the vote ledger, `entity` is self-declared in the tool arguments — the profile provides an additional verification layer if you want it.

---

## Putting it together: the full directory

```
~/.forge/vote-ledger/
  package.json
  .env                        # PORT, VOTE_LEDGER_DATA_DIR, DAEMON_URL
  .koad-io-index.yaml
  data/
    votes.jsonl               # written at runtime
  src/
    index.js
    state/
      jsonl.js
      vote-store.js
    api/
      votes.js
    streams/
      daemon-ddp.js
      daemon-write.js
    mcp/
      server.js
      auth.js
      vote-tools.js
```

The `package.json` dependency set stays intentionally minimal:

```json
{
  "name": "vote-ledger",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "dev":   "node --watch src/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.10.2",
    "express": "^4.21.2",
    "simpleddp": "^2.2.4",
    "ws": "^8.18.2",
    "zod": "^3.23.8"
  },
  "engines": { "node": ">=18" }
}
```

No Mongo. No Meteor. No ORM. Express for HTTP, the MCP SDK for the tool protocol, simpleDDP for the read path to the daemon, zod for tool schemas. That is the full dependency profile.

---

## The read path through DDP

Your service writes JSONL. The daemon projects it into DDP collections via the indexer. Storefront and other Meteor consumers subscribe to those collections. This is the write-JSONL / read-DDP pattern.

Your service itself can also subscribe to the daemon's collections — useful when you need to react to changes in kingdom state that you didn't write:

```js
// src/streams/daemon-ddp.js
import SimpleDDP from 'simpleddp';
import ws from 'ws';

const DAEMON_URL = process.env.DAEMON_URL || 'http://10.10.10.10:28282';

// In-memory cache: collectionName → Map<_id, record>
const _caches = {
  Entities: new Map(),
};

export function connectDaemonDdp() {
  const ddp = new SimpleDDP({
    endpoint: DAEMON_URL,
    SocketConstructor: ws,
    reconnectInterval: 5000,
  });

  ddp.on('connected', async () => {
    console.log('[daemon-ddp] connected');
    await ddp.subscribe('entities');
    ddp.collection('Entities').onChange(({ prev, next, action }) => {
      if (action === 'removed') _caches.Entities.delete(prev._id);
      else _caches.Entities.set(next._id, next);
    });
  });

  ddp.on('disconnected', () => console.log('[daemon-ddp] disconnected, reconnecting...'));
}

export function entities() {
  return [..._caches.Entities.values()];
}
```

The vote-ledger example only subscribes to `Entities` to know which entities exist. A more complex service might subscribe to `Flights`, `Emissions`, or any other daemon-projected collection it needs to react to.

For the write path (opening a flight or emission for your service's activity), see `daemon-write.js` in dance-hall. It is a thin `http.request` wrapper that POSTs JSON to the daemon's `/api/emit` and `/api/flight` endpoints.

---

## Configuration

Every sovereign service reads its configuration from environment variables populated by the koad:io cascade. The cascade sources `.env` files before Node starts — pick up from `process.env`, not from disk at runtime.

Standard variables a service should honor:

| Variable | Default | Description |
|----------|---------|-------------|
| `KOAD_IO_BIND_IP` | `10.10.10.10` | Network address to bind; set to `127.0.0.1` for local dev without mesh |
| `PORT` | (service-specific) | HTTP port; pick a port that doesn't conflict with existing services |
| `DAEMON_URL` | `http://10.10.10.10:28282` | Daemon endpoint for DDP and REST calls |
| `<SERVICE>_DATA_DIR` | `~/.forge/<service>/data/` | Override the data directory |

Existing port assignments to avoid conflicts:

| Port | Service |
|------|---------|
| 28282 | Daemon |
| 28383 | Dance-hall |
| 28284 | Control-tower |
| 28285 | Storefront |

Pick a port in the `28300–28399` range for new services, or declare it in your service's `.env` and document it here.

---

## Cross-references

This pattern composes several independently documented pieces:

- **Environment cascade** — how `.env` files are sourced before your service starts, and why you read from `process.env` rather than loading files yourself. [The koad:io Environment Cascade](../cascade/index.md)

- **Pluggable indexer** — full walkthrough for the `.koad-io-index.yaml` declaration, both subscription paths (direct and via bridge), the live update loop, and common confusion points. [The Pluggable Indexer — Getting Started](../pluggable-indexers/index.md)

- **MCP tool cascade (SPEC-137)** — how entity-specific tools are discovered and loaded, and the naming conventions for tool directories. [Entity Tool Cascade](../../.livy/docs/guides/entity-tool-cascade.md)

- **Dance-hall server layer** — the reference implementation this pattern was extracted from. All implementation details live there. [`~/.forge/dance-hall/src/README.md`](../../../.forge/dance-hall/src/README.md)

- **Dance-hall MCP layer** — the reference implementation for the MCP server, auth, and tool loading. [`~/.forge/dance-hall/src/mcp/README.md`](../../../.forge/dance-hall/src/mcp/README.md)

---

## Known gaps

**Auth scope enforcement is not shown in this tutorial.** The vote-tools example above does not enforce which entities can vote on which topics. Dance-hall's `auth.js` shows the full bond-type → scope-set resolution. If your service needs per-entity authorization beyond mesh-trust, read that file and adapt.

**`archiveTo` is not shown.** The vote ledger grows forever. If your use case needs archival (cycling a current-state file into a running archive), use the `archiveTo` primitive from `jsonl.js`. The announcement store in dance-hall shows the pattern: every new announcement archives the previous one.

**This is a pattern, not a packaging template.** There is no `koad:io create-service` command. The pattern is architectural. Replicating it means starting from an empty directory and following the structure above, not cloning a scaffold. The simplicity is intentional: a scaffold would encode decisions that every service should make for itself.

---

*Maintained by Livy. If the behavior described here diverges from dance-hall's implementation, file a doc-update issue at [github.com/koad/livy](https://github.com/koad/livy).*
