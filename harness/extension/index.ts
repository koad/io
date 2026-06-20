/**
 * koad-io harness extension for pi.
 *
 * Wires the full entity runtime:
 *   0. Bond scope          — resolve trust bonds from disk FIRST (synchronous)
 *   1. Tool registry        — only registers tools the bond scope allows
 *   2. Bond gate            — tool_call-level deny-by-default enforcement
 *   3. Tool policy          — DDP-driven live tool scoping updates
 *   4. DDP setup            — live WebSocket connections (auxiliary; skipped in SDK mode)
 *   5. Lifecycle hooks      — session events bridged to kingdom bash hooks
 *   6. Context budget       — staged context warnings + auto-compaction
 *   7. Circuit breaker      — provider failure detection and recovery
 *
 * See PRIMER.md for architecture overview.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DDPClient } from "./ddp";
import type { BondScope } from "./bond-gate/types";
import { resolveGate } from "./bond-gate/resolve";

import { registerHarnessTools } from "./tool-registry";
import { registerBondGate } from "./bond-gate";
import { registerToolPolicy } from "./tool-policy";
import { sdkMode, resolveVisitorConfig } from "./visitor-config";
import { setupDdp } from "./ddp-setup";
import { registerHooks } from "./lifecycle";
import { registerContextBudget } from "./context-budget";
import { registerProviderCircuitBreaker } from "./circuit-breaker";

export default function (pi: ExtensionAPI) {
  const inSdkMode = sdkMode();

  // ── Step 0: Resolve bond scope FIRST ────────────────────────────
  //
  // Synchronous — reads bond files from ~/.<entity>/trust/bonds/.
  // This scope gates which tools are even registered. The bond gate
  // and tool policy modules re-resolve on session_start for
  // interactive-mode overrides and DDP-driven live updates.
  const entity = process.env.ENTITY ?? "";
  let scope: BondScope | null = null;
  if (entity && !inSdkMode) {
    scope = resolveGate(entity, false);
  }

  // ── Step 1: Tool registry (scope-gated) ─────────────────────────
  //
  // Only registers tools the bond scope allows. Built-in replacements
  // (read/write/edit/bash/etc.) are always registered — the bond gate
  // enforces at tool_call level. Ecosystem tools (dispatch, channels,
  // koad-io, search, etc.) are only registered if the bond grants them.
  registerHarnessTools(pi, scope);

  // ── Step 2: Tool policy (DDP-driven live updates) ───────────────
  //
  // Listens for koad-io:bond-scope events. When bonds change via DDP,
  // re-scopes the active tool set without re-registering.
  registerToolPolicy(pi);

  // ── Step 3: DDP setup (auxiliary) ────────────────────────────────
  //
  // Only when not in SDK/visitor mode. Sets up two WebSocket connections
  // (control-tower + daemon) and all DDP-dependent plugins.
  let daemonDDP: DDPClient | null = null;
  let controlDDP: DDPClient | null = null;
  if (!inSdkMode) {
    const ddp = setupDdp(pi, scope);
    daemonDDP = ddp.daemon;
    controlDDP = ddp.control;
  }

  // ── Step 4: Bond gate (tool_call enforcement) ─────────────────────
  //
  // Deny-by-default permission enforcement on every tool call.
  // In entity mode, resolves trust bonds. In visitor mode, uses
  // the access scope from KOAD_IO_VISITOR_SCOPE env var.
  //
  // Receives the daemon DDP client for live bond updates.
  // In SDK mode, this is null and DDP monitoring is skipped.
  const visitorConfig = resolveVisitorConfig();
  registerBondGate(pi, daemonDDP, visitorConfig);

  // ── Step 5: Lifecycle hooks (always-on) ───────────────────────────
  registerHooks(pi, controlDDP ?? undefined);

  // ── Step 6: Context budget (always-on) ─────────────────────────────
  registerContextBudget(pi);

  // ── Step 7: Circuit breaker (always-on) ────────────────────────────
  registerProviderCircuitBreaker(pi);
}
