# mcp-service

MCP Service — Kingdom Tool Substrate for AI Harnesses

Implements VESTA-SPEC-139. Exposes an MCP endpoint at `http://10.10.10.10:28282/mcp` over HTTP+SSE transport.

## Two layers of tools

**Layer 1: Entity tool re-exposure (VESTA-SPEC-137 cascade)**
- Walks `~/.<entity>/tools/` (entity tier) and `~/.koad-io/packages/harness/tools/` (framework tier)
- Entity tools override framework tools on name collision
- Same `tool.json` + `handler.js` definitions, different transport

**Layer 2: Daemon state tools (13 tools)**

Read (7): `daemon.emissions.active`, `daemon.flights.by_entity`, `daemon.messages.count`,
`daemon.tickler.due`, `daemon.sessions.active`, `daemon.kingdoms.list`, `daemon.entities.list`

Write (6): `daemon.emission.open`, `daemon.emission.update`, `daemon.emission.close`,
`daemon.flight.open`, `daemon.flight.close`, `daemon.tickler.defer`, `daemon.message.drop`

## Authentication

Bearer token = harness session ID from `HarnessSessions` collection. Present in `Authorization: Bearer <token>` header.

Unauthenticated connections receive HTTP 401.

## Bond-gated scope

Bond type → scopes (VESTA-SPEC-139 §5.2):

| Bond type | Scopes |
|-----------|--------|
| authorized-agent | read.all, write.all |
| authorized-builder | read.all, write.emissions.own, write.flights.own |
| authorized-specialist | read.own, write.emissions.own, read.kingdom.summary |
| peer | read.own, read.kingdom.summary |
| community-member / kingdom-peer | read.kingdom.summary |

## Transport

- `POST /mcp` — send JSON-RPC messages (initialize, tools/list, tools/call)
- `GET /mcp/sse` — open SSE stream for notifications + async responses

Session correlation via `Mcp-Session-Id` header (assigned at authentication).

## Usage (Claude Code)

Add to `~/.koad-io/settings.json` mcpServers:

```json
{
  "name": "kingdom",
  "transport": "sse",
  "url": "http://10.10.10.10:28282/mcp",
  "headers": {
    "Authorization": "Bearer <session-token>"
  }
}
```

The session token is the `_id` from the entity's `HarnessSessions` record.

## OQ-5 (tickler.defer)

The daemon has no tickler write REST endpoint. `daemon.tickler.defer` writes directly
to `~/.<entity>/tickler/` as a markdown file. The tickler indexer picks it up on next scan.
