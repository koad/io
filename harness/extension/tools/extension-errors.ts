/**
 * extension_errors — inspect the harness extension's own error state.
 *
 * Shows the error ring buffer (last 100 errors), DDP connection statuses,
 * and subscription failures. Helps diagnose why the harness isn't working
 * without guessing at server-side logs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getDDPClients, getDDPClient, type DDPClient } from "../ddp";
import { getOwnSessionId } from "../identity/telemetry";

let _kingdomRef: any = null;

/** Called by ddp-setup after telemetry session is created so the tool can read error state. */
export function setExtensionErrorState(kingdom: any): void {
  _kingdomRef = kingdom;
}

export function registerExtensionErrorsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "extension_errors",
    label: "Extension Errors",
    description: [
      "Inspect the harness extension's own error state — DDP connection issues,",
      "subscription failures, error ring buffer, and connection health.",
      "Use this when the harness behaves unexpectedly or tools show stale data.",
    ].join("\n"),
    promptSnippet: "Check harness extension errors and DDP health",
    promptGuidelines: [
      "Use extension_errors when tools show stale data or DDP seems broken.",
      "Shows the same errors that appear in the harness footer error count.",
    ],
    parameters: Type.Object({}),

    async execute() {
      const lines: string[] = [];

      // DDP connection status
      lines.push("── DDP connections ──");
      const clients = getDDPClients();
      for (const [backend, client] of clients) {
        const ok = client.isConnected ? "connected" : "DISCONNECTED";
        const warm = client.isWarm
          ? "warm"
          : `warming (${client.warmProgress.ready}/${client.warmProgress.total})`;
        lines.push(`  ${backend}: ${ok}, ${warm}`);
      }
      lines.push("");

      // Own session state
      lines.push("── Own session ──");
      const ownSid = getOwnSessionId();
      if (ownSid) {
        const control = getDDPClient("control");
        const doc = control?.getOwnSessionDoc() ?? null;
        if (doc) {
          const entity = doc.entity || doc.entityHandle || doc.entityId || "?";
          const status = doc.status || doc.state || "?";
          const model = doc.model || doc.modelId || "?";
          lines.push(`  _id:        ${doc._id}`);
          lines.push(`  entity:     ${entity}`);
          lines.push(`  status:     ${status}`);
          lines.push(`  host:       ${doc.host ?? "?"}`);
          lines.push(`  model:      ${model}`);
          if (doc.cost != null)       lines.push(`  cost:       ${doc.cost.toFixed(2)}`);
          if (doc.tokensIn != null)   lines.push(`  tokensIn:   ${doc.tokensIn}`);
          if (doc.tokensOut != null)  lines.push(`  tokensOut:  ${doc.tokensOut}`);
          if (doc.turnCount != null)  lines.push(`  turnCount:  ${doc.turnCount}`);
          if (doc.toolCount != null)  lines.push(`  toolCount:  ${doc.toolCount}`);
          if (doc.contextPct != null) lines.push(`  contextPct: ${Math.round(doc.contextPct)}%`);
          if (doc.cwd)                lines.push(`  cwd:        ${doc.cwd}`);
          if (doc.harness)            lines.push(`  harness:    ${doc.harness}`);

          // Last 3 signals — emissions related to this session
          const daemon = getDDPClient("daemon");
          const emissions = daemon?.emissionsList ?? [];
          const sigCandidates = emissions
            .filter(e => {
              const entityMatch = e.entity && doc.entity && e.entity === doc.entity;
              const missionMatch = e.missionId && doc._id && e.missionId.includes(doc._id.slice(0, 8));
              return entityMatch || missionMatch;
            })
            .slice(-3);
          if (sigCandidates.length > 0) {
            lines.push("");
            lines.push(`  ── last ${sigCandidates.length} signals ──`);
            for (const sig of sigCandidates) {
              const type = sig.type ?? "?";
              const body = (sig.body ?? "").slice(0, 80);
              const at = sig.startedAt ? new Date(sig.startedAt).toISOString().slice(11, 19) : "?";
              lines.push(`  ${type.padEnd(14)} ${at}  ${body}`);
            }
          }
        } else {
          lines.push(`  ownSessionId: ${ownSid.slice(0, 20)}… (not yet received via DDP)`);
        }
      } else {
        lines.push("  (not yet known — session.hello not returned or DDP not connected)");
      }

      lines.push("");

      // Error ring buffer
      lines.push("── Error log ──");
      if (_kingdomRef?.errorLog?.length > 0) {
        const errors = _kingdomRef.errorLog.slice(-20);
        for (const e of errors) {
          const tool = e.toolName ? `[${e.toolName}] ` : "";
          const time = e.at ? e.at.slice(11, 19) : "?";
          lines.push(`  ${time} ${tool}${e.msg}`);
        }
      } else {
        lines.push("  (no errors recorded)");
      }

      const errorCount = _kingdomRef?.errorCount ?? 0;
      lines.push(`  total: ${errorCount}`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          errorCount,
          ddpBackends: [...clients.keys()],
        },
      };
    },
  });
}
