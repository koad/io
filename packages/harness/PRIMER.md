# koad:io-harness — Entity Conversation Harness

Meteor package that serves koad:io entities as conversation endpoints over HTTP/SSE. Add to any koad:io Meteor app, configure in settings, done.

## What it does

Mounts HTTP routes inside a running Meteor server. Each harness instance serves one or more entities at a path prefix. Visitors POST to `/chat`, get back SSE-streamed responses from the entity's configured inference provider.

## How to use

1. Add the package: `meteor add koad:io-harness`
2. Configure `Meteor.settings.harnesses` in your settings JSON
3. Start the app — harnesses auto-initialize

## Settings schema

```json
{
  "harnesses": [
    {
      "path": "/harness/jesus",
      "entities": ["jesus"],
      "entityBaseDir": "/home/koad",
      "cacheTTL": 300000,
      "provider": {
        "default": "xai",
        "xai": { "model": "grok-3", "maxTokens": 1024 }
      },
      "session": { "ttl": 1800000, "maxMessages": 50 },
      "rateLimits": { "enabled": false },
      "inputFilter": { "maxLength": 2000 },
      "cors": { "origins": ["https://churchofhappy.com"] }
    }
  ]
}
```

Multiple harnesses in one app — each with its own path, entities, and provider config.

## Routes (per harness prefix)

| Method | Path | Description |
|--------|------|-------------|
| GET | `{prefix}/health` | Health check + uptime + session count |
| GET | `{prefix}/entities` | List entities with outfit data (LOD via `?level=N`) |
| GET | `{prefix}/entities/:handle` | Single entity info |
| GET | `{prefix}/entities/:handle/avatar` | Entity avatar PNG |
| POST | `{prefix}/chat` | Conversation endpoint (SSE stream) |

## Chat request

```json
POST /harness/jesus/chat
{ "entity": "jesus", "message": "hello", "sessionId": "optional-existing-id" }
```

## SSE events

- `session` — `{ sessionId }` (first event, use for continuity)
- `chunk` — `{ text }` (streaming tokens)
- `done` — `{ fullText }` (complete response)
- `error` — `{ message, fallback }` (rate limit, input blocked, inference error)

## Providers

`xai` (Grok), `anthropic` (Claude), `groq` (Llama), `ollama` (local), `mock` (testing).

## Pipeline

- **Input filter:** injection detection, length limits
- **Output filter:** role-break detection, system prompt leakage prevention
- **Rate limiter:** per-session, per-IP, global concurrent limits
- **Session store:** in-memory with TTL cleanup

## Entity loading

Reads from `~/.{entity}/` directories: `.env`, `CLAUDE.md`, `PRIMER.md`, `landing.md`, `passenger.json`, `fallbacks.json`, `memories/*.md`, `avatar.png`. Outfit normalization follows VESTA-SPEC-063 LOD levels.

## Architecture

```
~/.koad-io/packages/harness/     ← This package (framework layer)
~/.kingdom/websites/*/config/    ← Settings per deployment (harness config)
~/.<entity>/                     ← Entity data (identity layer)
```

The package is the runtime. The settings are the deployment. The entity folder is the identity. Three clean layers.
