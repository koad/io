/**
 * koad-io ddp tool — inspect the harness's DDP connections from within.
 *
 * Queries live DDP state: connection status, session IDs, subscriptions,
 * local collection contents, and health snapshots. Both daemon and
 * control-tower connections are available.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getDDPClient, getDDPClients, type DDPClient, type SessionRecord } from "../ddp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientSummary(client: DDPClient, label: string): string {
  const connected = client.isConnected;
  const warm = client.isWarm;
  const progress = client.warmProgress;
  const flights = client.flightCount;
  const sessions = client.sessionCount;
  const entities = client.entityCount;
  const bonds = client.bondCount;
  const emissions = client.emissionsList.length;

  const lines: string[] = [];
  lines.push(`${label}: ${connected ? "connected" : "disconnected"}`);
  if (connected) {
    lines.push(`  warm: ${warm ? "yes" : `no (${progress.ready}/${progress.total})`}`);
    lines.push(`  flights: ${flights}  sessions: ${sessions}  entities: ${entities}`);
    lines.push(`  bonds: ${bonds}  emissions: ${emissions}`);
    const h = client.health;
    if (h[label as keyof typeof h] !== undefined) {
      lines.push(`  health: ${(h as any)[label] ?? "unknown"}`);
    }
  }
  return lines.join("\n");
}

function healthBlock(client: DDPClient): string {
  const h = client.health;
  return [
    `daemon:  ${h.daemon} (ready=${h.daemonReady}, uptime=${h.daemonUptime}s)`,
    `control: ${h.control} (ready=${h.controlReady}, uptime=${h.controlUptime}s)`,
  ].join("\n");
}

/** Normalize session fields from different collection shapes (HarnessSessions, LibrarySessions, ApplicationSessions). */
function sessionEntity(s: SessionRecord): string {
  return s.entity || s.entityHandle || s.entityId || "?";
}

function sessionStatus(s: SessionRecord): string {
  return s.status || s.state || "?";
}

function sessionModel(s: SessionRecord): string {
  return s.model || s.modelId || "?";
}

function trunc80(s: string | undefined | null): string {
  if (!s) return "";
  const str = String(s);
  return str.length > 80 ? str.slice(0, 77) + "..." : str;
}

/** Format a date-like value for display. */
function fmtDate(v: string | undefined | null): string {
  if (!v) return "?";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 19);
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(v).slice(0, 19);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDDPTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ddp",
    label: "DDP Inspector",
    description: [
      "Inspect the harness's live DDP connections to daemon and control-tower.",
      "Shows connection status, session IDs, active subscriptions, local collection",
      "contents, health snapshots, and allows calling DDP methods directly.",
      "",
      "Sub-commands:",
      "  status       — connection overview (both backends), waits for warm",
      "  collections  — list local collections and document counts",
      "  flights      — list active/recent flights",
      "  sessions     — list active/recent sessions",
      "  session <id> — show one session in detail with signal history",
      "  method       — call a DDP method and return the result",
      "  subscribe    — subscribe to a publication at runtime",
      "  publications — list available publications (via meteor_shell)",
    ].join("\n"),
    promptSnippet: "DDP: status|collections|flights|sessions|session <id>|method|subscribe|publications",
    promptGuidelines: [
      "Use ddp status to verify DDP connections are alive before dispatching.",
      "Use ddp flights to see what's airborne without hitting the daemon CLI.",
      "Use ddp session <id> to drill into one session's telemetry.",
      "Use ddp subscribe to pull data from publications not auto-subscribed.",
      "Use ddp method to call a DDP method directly for debugging.",
      "The DDP connection IS the identity — use this to verify your session state.",
    ],
    parameters: Type.Object({
      sub: Type.Optional(Type.String({
        description: "Sub-command: status (default), collections, flights, sessions, session, method, subscribe, publications.",
        default: "status",
      })),
      methodName: Type.Optional(Type.String({
        description: "DDP method name (for sub=method).",
      })),
      methodArgs: Type.Optional(Type.String({
        description: "JSON array of method arguments (for sub=method), e.g. '[flightId, stats]'.",
      })),
      sessionId: Type.Optional(Type.String({
        description: "Session _id (for sub=session).",
      })),
      pubName: Type.Optional(Type.String({
        description: "Publication name (for sub=subscribe).",
      })),
      pubArgs: Type.Optional(Type.String({
        description: "JSON array of publication arguments (for sub=subscribe), e.g. '[entityName]'.",
      })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate) {
      const sub = params.sub ?? "status";
      const clients = getDDPClients();

      if (clients.size === 0) {
        return {
          content: [{ type: "text", text: "No DDP clients registered. Running in SDK/offline mode?" }],
        };
      }

      switch (sub) {
        case "status": {
          // Wait for live client to warm before reporting
          const live = getDDPClient("live");
          if (live?.isConnected) {
            await live.waitForWarm(5000);
          }

          const lines: string[] = [];
          for (const [backend, client] of clients) {
            lines.push(clientSummary(client, backend));
          }

          // Show health from the daemon client (it receives health pubs)
          const daemon = getDDPClient("daemon");
          if (daemon) {
            lines.push("");
            lines.push("health:");
            lines.push(healthBlock(daemon));
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              backends: [...clients.keys()],
              connected: [...clients.values()].every(c => c.isConnected),
            },
          };
        }

        case "collections": {
          const lines: string[] = [];
          for (const [backend, client] of clients) {
            lines.push(`── ${backend} ──`);
            lines.push(`  flights:   ${client.flightCount} docs`);
            lines.push(`  sessions:  ${client.sessionCount} docs`);
            lines.push(`  entities:  ${client.entityCount} docs`);
            lines.push(`  bonds:     ${client.bondCount} docs`);
            lines.push(`  emissions: ${client.emissionsList.length} docs`);
            lines.push(`  warm:      ${client.isWarm ? "yes" : `no (${client.warmProgress.ready}/${client.warmProgress.total})`}`);
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        }

        case "flights": {
          const lines: string[] = [];
          const control = getDDPClient("control");
          if (!control) {
            return { content: [{ type: "text", text: "No control-tower DDP client." }] };
          }
          const flights = control.flightsList;
          if (flights.length === 0) {
            return { content: [{ type: "text", text: "No flights in local index." }] };
          }
          for (const f of flights) {
            const status = f.status ?? "?";
            const entity = f.entity ?? "?";
            const brief = (f.briefSlug ?? "").slice(0, 50) || "?";
            lines.push(`${f._id.slice(0, 10)}  ${entity.padEnd(10)} ${status.padEnd(12)} ${brief}`);
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: { count: flights.length },
          };
        }

        case "sessions": {
          const lines: string[] = [];
          // Sessions may come from either backend
          for (const [backend, client] of clients) {
            const sessions = client.sessionsList;
            if (sessions.length === 0) continue;
            lines.push(`── ${backend} ──`);
            for (const s of sessions) {
              const status = sessionStatus(s);
              const entity = sessionEntity(s);
              const host = s.host ?? "?";
              lines.push(`${s._id.slice(0, 10)}  ${entity.padEnd(10)} ${status.padEnd(10)} ${host}`);
            }
          }
          if (lines.length === 0) {
            return { content: [{ type: "text", text: "No sessions in local index." }] };
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        // ── NEW: session <id> — show one session in detail ─────────────
        case "session": {
          const id = (params.sessionId as string) ?? "";
          if (!id) {
            return { content: [{ type: "text", text: "sessionId is required for sub=session" }] };
          }

          // Search across all backends
          let found: SessionRecord | null = null;
          let foundBackend = "";
          for (const [backend, client] of clients) {
            const hit = client.sessionsList.find(s => s._id === id);
            if (hit) { found = hit; foundBackend = backend; break; }
          }

          if (!found) {
            return { content: [{ type: "text", text: `Session '${id}' not found in any local DDP index.` }] };
          }

          const s = found;
          const lines: string[] = [];
          lines.push(`── session detail (${foundBackend}) ──`);
          lines.push(`  _id:       ${s._id}`);
          lines.push(`  entity:    ${sessionEntity(s)}`);
          lines.push(`  status:    ${sessionStatus(s)}`);
          lines.push(`  host:      ${s.host ?? "?"}`);
          lines.push(`  model:     ${sessionModel(s)}`);
          if (s.cost != null)       lines.push(`  cost:      $${s.cost.toFixed(2)}`);
          if (s.tokensIn != null)   lines.push(`  tokensIn:  ${s.tokensIn}`);
          if (s.tokensOut != null)  lines.push(`  tokensOut: ${s.tokensOut}`);
          if (s.turnCount != null)  lines.push(`  turnCount: ${s.turnCount}`);
          if (s.toolCount != null)  lines.push(`  toolCount: ${s.toolCount}`);
          if (s.contextPct != null) lines.push(`  contextPct:${Math.round(s.contextPct)}%`);
          if (s.cwd)                lines.push(`  cwd:       ${s.cwd}`);
          if (s.harness)            lines.push(`  harness:   ${s.harness}`);
          if (s.pid != null)        lines.push(`  pid:       ${s.pid}`);
          if (s.spirit)             lines.push(`  spirit:    ${s.spirit}`);
          lines.push(`  startedAt: ${fmtDate(s.startedAt)}`);
          lines.push(`  lastSeen:  ${fmtDate(s.lastSeen)}`);
          if (s.endedAt)            lines.push(`  endedAt:   ${fmtDate(s.endedAt)}`);

          // Last 10 signals — emissions related to this session (by entity or missionId)
          const emissions = (getDDPClient("daemon") ?? getDDPClient("control"))?.emissionsList ?? [];
          const sigCandidates = emissions
            .filter(e => {
              const entityMatch = e.entity && s.entity && e.entity === s.entity;
              const missionMatch = e.missionId && s._id && e.missionId.includes(s._id.slice(0, 8));
              return entityMatch || missionMatch;
            })
            .slice(-10);
          if (sigCandidates.length > 0) {
            lines.push("");
            lines.push(`  ── last ${sigCandidates.length} signals ──`);
            for (const sig of sigCandidates) {
              const type = sig.type ?? "?";
              const body = trunc80(sig.body);
              const at = sig.startedAt ? fmtDate(sig.startedAt).slice(11) : "?";
              lines.push(`  ${type.padEnd(12)} ${at}  ${body}`);
            }
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: { sessionId: s._id, backend: foundBackend },
          };
        }

        // ── NEW: subscribe <publication> [args] ────────────────────────
        case "subscribe": {
          const pubName = (params.pubName as string) ?? "";
          if (!pubName) {
            return { content: [{ type: "text", text: "pubName is required for sub=subscribe" }] };
          }

          let pubArgs: unknown[] = [];
          if (params.pubArgs) {
            try {
              pubArgs = JSON.parse(params.pubArgs as string);
              if (!Array.isArray(pubArgs)) {
                return { content: [{ type: "text", text: "pubArgs must be a JSON array, e.g. '[\"juno\"]'" }] };
              }
            } catch {
              return { content: [{ type: "text", text: "pubArgs is not valid JSON" }] };
            }
          }

          // Try control first, then daemon
          const subTarget = (getDDPClient("control")?.isConnected ? getDDPClient("control") : null) ??
                            (getDDPClient("daemon")?.isConnected ? getDDPClient("daemon") : null) ??
                            getDDPClient("live");

          if (!subTarget?.isConnected) {
            return { content: [{ type: "text", text: "No connected DDP client available for subscribe." }] };
          }

          try {
            await subTarget.subscribe(pubName, ...pubArgs);
            return {
              content: [{ type: "text", text: `Subscribed to '${pubName}'${pubArgs.length ? ` with args ${JSON.stringify(pubArgs)}` : ""}` }],
              details: { pub: pubName, args: pubArgs, backend: subTarget.role },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Subscribe failed: ${err.message || err}` }],
              details: { error: err.message, pub: pubName },
            };
          }
        }

        // ── NEW: publications — list available publications ────────────
        case "publications": {
          // Try to query via meteor_shell on control then daemon
          const targets = ["control", "daemon"] as const;
          const lines: string[] = [];

          for (const t of targets) {
            const client = getDDPClient(t);
            if (!client?.isConnected) continue;

            try {
              // Attempt to list publications via a Meteor introspection method.
              // Not all servers have this — degrade gracefully.
              const result = await client.call("eval.server", `
                (function() {
                  try {
                    // Meteor 3: publications are on Meteor.server.publish_handlers
                    if (typeof Meteor !== 'undefined' && Meteor.server && Meteor.server.publish_handlers) {
                      return Object.keys(Meteor.server.publish_handlers).sort();
                    }
                    // Fallback: try to find the publication registry
                    if (typeof globalThis !== 'undefined' && globalThis.__koad_pub_list) {
                      return globalThis.__koad_pub_list;
                    }
                    return null;
                  } catch(e) { return String(e); }
                })()
              `);

              lines.push(`── ${t} ──`);
              if (result === null || result === undefined) {
                lines.push("  (publication introspection not available)");
              } else if (typeof result === "string") {
                lines.push(`  (error: ${result})`);
              } else if (Array.isArray(result)) {
                if (result.length === 0) {
                  lines.push("  (no publications registered)");
                } else {
                  for (const name of result) {
                    lines.push(`  ${name}`);
                  }
                }
              } else {
                lines.push(`  (unexpected result type: ${typeof result})`);
              }
            } catch (err: any) {
              lines.push(`── ${t} ──`);
              lines.push(`  (failed to query: ${err.message || err})`);
            }
          }

          if (lines.length === 0) {
            return { content: [{ type: "text", text: "No connected backends to query for publications." }] };
          }

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        case "method": {
          if (!params.methodName) {
            return {
              content: [{ type: "text", text: "methodName is required for sub=method" }],
              details: { error: "missing methodName" },
            };
          }

          let args: unknown[] = [];
          if (params.methodArgs) {
            try {
              args = JSON.parse(params.methodArgs);
              if (!Array.isArray(args)) {
                return {
                  content: [{ type: "text", text: "methodArgs must be a JSON array, e.g. '[arg1, arg2]'" }],
                  details: { error: "invalid methodArgs" },
                };
              }
            } catch {
              return {
                content: [{ type: "text", text: "methodArgs is not valid JSON" }],
                details: { error: "parse failed" },
              };
            }
          }

          // Try control first, then daemon
          const control = getDDPClient("control");
          const daemon = getDDPClient("daemon");
          const target = (control?.isConnected ? control : null) ??
                         (daemon?.isConnected ? daemon : null);

          if (!target) {
            return {
              content: [{ type: "text", text: "No connected DDP client available." }],
              details: { error: "no connection" },
            };
          }

          try {
            const result = await target.call(params.methodName, ...args);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: { method: params.methodName, backend: target.role },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `DDP method failed: ${err.message || err}` }],
              details: { error: err.message, method: params.methodName },
            };
          }
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown sub-command: ${sub}. Use status, collections, flights, sessions, session, method, subscribe, or publications.` }],
          };
      }
    },
  });
}
