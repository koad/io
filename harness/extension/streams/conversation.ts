/**
 * koad-io conversation stream — injects DDP events into the conversation.
 *
 * Listens to the existing DDP emission subscription and surfaces relevant
 * events as system messages. No new connection — rides the same WebSocket
 * the footer telemetry already uses.
 *
 * Events filtered:
 *   - Flight landed/error for flights dispatched by this entity
 *   - Errors from watched entities
 *   - Channel cues (when channel backend is active)
 *   - Messages received (emission type "message")
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DDPClient, type EmissionRecord } from "../ddp";

const ENTITY = process.env.ENTITY ?? "";
const SESSION_ID = process.env.HARNESS_SESSION_ID ?? "";

// Track which flight IDs we already reported so we don't double-inject
const reported = new Set<string>();

export function startConversationStream(pi: ExtensionAPI, ddp: DDPClient): void {
  ddp.on("emission", (_event, record: EmissionRecord) => {
    // Skip our own emissions
    if (record.entity === ENTITY) return;

    const fid = (record as any).flightId;
    const status = record.status;
    const type = record.type;

    // ── Flight landed ──────────────────────────────────────────
    if (fid && (status === "closed" || status === "landed") && !reported.has(fid)) {
      reported.add(fid);
      const shortId = fid.replace(/^\d{8}T\d{6}-\d{3}Z-/, "");
      pi.sendMessage(
        {
          customType: "koad-io-stream",
          content: `✓ **${record.entity}** landed ⟐ \`${shortId}\``,
          display: true,
          details: { flightId: fid, entity: record.entity, status },
        },
        { triggerTurn: false },
      );
      return;
    }

    // ── Flight error ───────────────────────────────────────────
    if (fid && (status === "error" || status === "failed") && !reported.has(fid)) {
      reported.add(fid);
      const shortId = fid.replace(/^\d{8}T\d{6}-\d{3}Z-/, "");
      const note = (record as any).closingNote || (record as any).completionSummary || "";
      pi.sendMessage(
        {
          customType: "koad-io-stream",
          content: `⚠ **${record.entity}** error ⟐ \`${shortId}\` — ${note}`,
          display: true,
          details: { flightId: fid, entity: record.entity, status, note },
        },
        { triggerTurn: false },
      );
      return;
    }

    // ── Error emissions (kingdom-wide) ─────────────────────────
    if (type === "error" && record.body) {
      pi.sendMessage(
        {
          customType: "koad-io-stream",
          content: `⚠ **${record.entity}**: ${record.body}`,
          display: true,
          details: { entity: record.entity, body: record.body },
        },
        { triggerTurn: false },
      );
      return;
    }

    // ── Messages to this entity ────────────────────────────────
    if (type === "message" && record.body) {
      pi.sendMessage(
        {
          customType: "koad-io-stream",
          content: `📨 **${record.entity}**: ${record.body}`,
          display: true,
          details: { entity: record.entity, body: record.body },
        },
        { triggerTurn: false },
      );
      return;
    }

    // ── Chat messages (YouTube / external) ─────────────────────
    if (type === "chat.message" && record.body) {
      const viewer = (record as any).meta?.payload?.viewer || record.entity;
      pi.sendMessage(
        {
          customType: "koad-io-stream",
          content: `📺 **${viewer}**: ${record.body}`,
          display: true,
          details: { viewer, body: record.body, platform: (record as any).meta?.payload?.platform },
        },
        { triggerTurn: false },
      );
      return;
    }
  });
}
