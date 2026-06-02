// koad:io bond-gate — registerBondGate() entry point.
//
// Gates every tool call against the entity's trust bonds.
// Bonds are signed capability grants from one entity to another.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDDP } from "../ddp";
import type { DDPClient, DDPEvent, BondRecord } from "../ddp";
import {
  type BondScope,
  GLOBAL_ALLOWED_TOOLS, SCOPED_SEARCH_TOOLS, FILE_READ_TOOLS, FILE_WRITE_TOOLS, SHELL_TOOLS,
  GATED_DISPATCH_TOOLS, KOADIO_TOOLS, PI_BUILTIN_TOOLS,
  isUnder, isBlocked, resolveToolPath, HOME,
  log, logMode,
} from "./types";
import { resolveGate, bondBlockReason, auditBlock } from "./resolve";

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

function scopeFingerprint(scope: BondScope): string {
  return JSON.stringify({
    mode: scope.mode,
    bondCount: scope.bondCount,
    deviceId: scope.deviceId,
    read: scope.file.read,
    write: scope.file.write,
    exec: scope.file.exec,
    blocked: scope.file.blocked,
    tools: scope.tools,
    entity: scope.entity_capabilities,
    errors: scope.errors,
  });
}

function scopeStatus(scope: BondScope): string {
  if (scope.mode === "bypass") return `bypass · device ${scope.deviceId}`;
  if (scope.errors.length > 0) {
    return `⚠ bonds: ${scope.errors[0]}${scope.errors.length > 1 ? ` (+${scope.errors.length - 1} more)` : ""} · device ${scope.deviceId}`;
  }
  return `${scope.bondCount} bond${scope.bondCount !== 1 ? "s" : ""} · r${scope.file.read.length} w${scope.file.write.length} e${scope.file.exec.length} · device ${scope.deviceId}`;
}

export function registerBondGate(pi: ExtensionAPI, ddp?: DDPClient | null) {
  ddp ??= getDDP();
  const entity = process.env.ENTITY ?? "";
  if (!entity) {
    log("ENTITY unset — gate disabled");
    return;
  }

  let scope = resolveGate(entity, false);
  let lastCtx: any;
  let lastHasUI = false;

  const updateStatus = (): void => {
    if (lastCtx?.hasUI) {
      lastCtx.ui.setStatus("bond-gate", scopeStatus(scope));
    }
  };

  const rebuildScope = (hasUI = lastHasUI): BondScope => {
    lastHasUI = hasUI;
    scope = resolveGate(entity, hasUI);
    pi.events.emit("koad-io:bond-scope", scope);
    updateStatus();
    return scope;
  };

  const isEcosystemTool = (toolName: string): boolean => {
    if (KOADIO_TOOLS.has(toolName)) return true;
    if (PI_BUILTIN_TOOLS.has(toolName)) return false;
    const allTools = pi.getAllTools();
    for (const t of allTools) {
      if (t.name === toolName) return true;
    }
    return false;
  };

  const hasKoadioGrant = (toolName: string): boolean => (
    scope.tools.koadio_tools.includes(toolName) || scope.tools.koadio_tools.includes("*")
  );

  const effectiveSearchRoots = (): string[] => {
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const rawRoot of scope.file.read) {
      const root = resolveToolPath(rawRoot, HOME);
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push(root);
    }
    return roots;
  };

  const installSearchRoots = (): string[] => {
    const roots = effectiveSearchRoots();
    if (roots.length > 0) {
      process.env.KOAD_IO_SEARCH_ROOTS = roots.join(":");
    } else {
      delete process.env.KOAD_IO_SEARCH_ROOTS;
    }
    return roots;
  };

  if (ddp) {
    ddp.on("bond", (event: DDPEvent, record: BondRecord) => {
      if (record.to && record.to !== entity && record.to !== "*" && record.from !== entity) return;
      const before = scopeFingerprint(scope);
      const next = rebuildScope(lastHasUI);
      const after = scopeFingerprint(next);
      if (before !== after) {
        log(`bond DDP ${event}: refreshed scope for ${entity}`);
      }
    });
  }

  // -----------------------------------------------------------------------
  // session_start
  // -----------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    rebuildScope(ctx.hasUI);
    logMode(ctx, scope.label, scope.mode === "bypass" ? "warning" : "info");

    if (scope.errors.length > 0) {
      for (const err of scope.errors) {
        ctx.ui.notify(`[bond-gate] ${err}`, "warning");
      }
    }
  });

  // -----------------------------------------------------------------------
  // tool_call
  // -----------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;

    lastCtx = ctx;
    rebuildScope(ctx.hasUI);
    const mode = scope.mode;

    if (mode === "bypass") return undefined;

    if (GLOBAL_ALLOWED_TOOLS.has(toolName)) {
      return undefined;
    }

    const effectiveCwd = process.env.HARNESS_WORK_DIR || ctx.cwd;
    const rawPath =
      (input as Record<string, unknown>)?.path as string | undefined
      ?? (input as Record<string, unknown>)?.directory as string | undefined;
    const defaultPath = toolName === "ls" ? "." : undefined;
    const pathArg = rawPath ?? defaultPath;
    const absolutePath = pathArg ? resolveToolPath(pathArg, effectiveCwd) : undefined;

    // ── Search/discovery tools — tool grant + read scope ──────
    if (SCOPED_SEARCH_TOOLS.has(toolName)) {
      if (!hasKoadioGrant(toolName)) {
        log(`BLOCK koadio tool ${toolName}: not in koadio_tools grant (mode=${mode})`);
        auditBlock(entity, toolName, "", "koadio tool not granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, `${toolName} not granted — add to koadio_tools in bond`, scope) };
      }
      const roots = installSearchRoots();
      if (roots.length === 0) {
        log(`BLOCK search: no scope (mode=${mode})`);
        auditBlock(entity, toolName, "", "no read permissions");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants read permissions — use koad-io tool or ask_question(to=\"koad\") to request access", scope) };
      }
      return undefined;
    }

    // ── Read tools — tool grant + read scope + blocked paths ──
    if (FILE_READ_TOOLS.has(toolName)) {
      if (!PI_BUILTIN_TOOLS.has(toolName) && !hasKoadioGrant(toolName)) {
        log(`BLOCK koadio tool ${toolName}: not in koadio_tools grant (mode=${mode})`);
        auditBlock(entity, toolName, rawPath ?? "", "koadio tool not granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, `${toolName} not granted — add to koadio_tools in bond`, scope) };
      }
      if (scope.file.read.length === 0) {
        log(`BLOCK read: no scope (mode=${mode})`);
        auditBlock(entity, toolName, rawPath ?? "", "no read permissions");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants read permissions — use koad-io tool or ask_question(to=\"koad\") to request access", scope) };
      }
      if (!absolutePath) {
        if (!isUnder(effectiveCwd, scope.file.read)) {
          auditBlock(entity, toolName, effectiveCwd, "cwd outside read scope");
          return { block: true, reason: bondBlockReason(entity, toolName, "working directory outside bond read scope", scope) };
        }
        return undefined;
      }
      if (absolutePath && isUnder(effectiveCwd, scope.file.read) && isUnder(absolutePath, [effectiveCwd])) {
        if (isBlocked(absolutePath, scope.file.blocked)) {
          auditBlock(entity, toolName, pathArg!, "blacklisted path");
          return { block: true, reason: bondBlockReason(entity, toolName, `${pathArg} is a protected path`) };
        }
        return undefined;
      }
      if (isBlocked(absolutePath, scope.file.blocked)) {
        auditBlock(entity, toolName, pathArg!, "blacklisted path");
        return { block: true, reason: bondBlockReason(entity, toolName, `${pathArg} is a protected path`) };
      }
      if (!isUnder(absolutePath, scope.file.read)) {
        auditBlock(entity, toolName, pathArg!, "outside read scope");
        return { block: true, reason: bondBlockReason(entity, toolName, `${pathArg} is outside bond scope`, scope) };
      }
      return undefined;
    }

    // ── koad:io ecosystem tools — bond-gated ──────────────────
    if (isEcosystemTool(toolName)) {
      if (!hasKoadioGrant(toolName)) {
        log(`BLOCK koadio tool ${toolName}: not in koadio_tools grant (mode=${mode})`);
        auditBlock(entity, toolName, "", "koadio tool not granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, `${toolName} not granted — add to koadio_tools in bond`, scope) };
      }
      if (toolName === "koad-io") {
        const command = (input as Record<string, unknown>)?.command as string | undefined;
        if (command && !scope.tools.koadio_commands.includes(command) && !scope.tools.koadio_commands.includes("*")) {
          log(`BLOCK koad-io command ${command}: not in koadio_commands grant (mode=${mode})`);
          auditBlock(entity, "koad-io", command, "cascade command not granted by bond");
          return { block: true, reason: bondBlockReason(entity, "koad-io", `command "${command}" not granted — add to koadio_commands in bond`, scope) };
        }
      }
      return undefined;
    }

    // ── Dispatch tools — gated by tool grant + target ────────
    if (GATED_DISPATCH_TOOLS.has(toolName)) {
      if (!scope.tools.dispatch) {
        log(`BLOCK dispatch: not granted (mode=${mode})`);
        return { block: true, reason: bondBlockReason(entity, toolName, "dispatch not granted by any bond — use ask_question(to=\"koad\") to request", scope) };
      }
      if (toolName === "dispatch") {
        const target = (input as Record<string, unknown>)?.entity as string | undefined;
        if (target && scope.entity_capabilities.dispatch_targets.length > 0 &&
            !scope.entity_capabilities.dispatch_targets.includes(target) &&
            !scope.entity_capabilities.dispatch_targets.includes("*")) {
          log(`BLOCK dispatch: target ${target} not in allowed list`);
          return { block: true, reason: bondBlockReason(entity, toolName, `dispatch to ${target} not allowed — targets: ${scope.entity_capabilities.dispatch_targets.join(", ")}`) };
        }
      }
      return undefined;
    }

    // ── Write tools — bond write scope + blocked patterns ────
    if (FILE_WRITE_TOOLS.has(toolName)) {
      if (scope.file.write.length === 0) {
        log(`BLOCK write: no scope (mode=${mode})`);
        auditBlock(entity, toolName, rawPath ?? "", "no write permissions");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants write permissions — use koad-io tool or ask_question(to=\"koad\") to request access", scope) };
      }
      if (absolutePath) {
        if (isBlocked(absolutePath, scope.file.blocked)) {
          auditBlock(entity, toolName, rawPath!, "blacklisted path");
          if (ctx.hasUI) ctx.ui.notify(`Blocked ${toolName}: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is a protected path`) };
        }
        if (!isUnder(absolutePath, scope.file.write)) {
          auditBlock(entity, toolName, rawPath!, "outside write scope");
          if (ctx.hasUI) ctx.ui.notify(`koad:io bond gate — ${toolName} blocked: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is outside bond scope`, scope) };
        }
      }
      return undefined;
    }

    // ── Shell — tool grant + exec scope ──────────────────────
    if (SHELL_TOOLS.has(toolName)) {
      if (!scope.tools.bash) {
        log(`BLOCK bash: not granted (mode=${mode})`);
        auditBlock(entity, "bash", "", "bash not granted by any bond");
        return { block: true, reason: bondBlockReason(entity, "bash", "no bond grants bash — use koad-io tool or ask_question(to=\"koad\") to request shell access", scope) };
      }
      if (scope.file.exec.length === 0) {
        auditBlock(entity, "bash", "", "bash granted but no exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", "bash granted but no exec paths — add exec paths to bond capabilities", scope) };
      }
      if (!isUnder(effectiveCwd, scope.file.exec)) {
        auditBlock(entity, "bash", effectiveCwd, "cwd outside exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", `working directory outside bond exec scope`, scope) };
      }
      return undefined;
    }

    log(`BLOCK ${toolName}: unrecognized (mode=${mode})`);
    auditBlock(entity, toolName, "", "unrecognized tool");
    return { block: true, reason: bondBlockReason(entity, toolName, "unrecognized tool — use koad-io tool or ask_question(to=\"koad\") to request capability expansion", scope) };
  });

  // -----------------------------------------------------------------------
  // before_agent_start: inject bond scope into system prompt
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", (_event, ctx) => {
    lastCtx = ctx;
    rebuildScope(ctx.hasUI);
    const parts = [
      `${scope.bondCount}b`,
      `r${scope.file.read.length} w${scope.file.write.length} e${scope.file.exec.length}`,
      `@${scope.deviceId}`,
    ];
    if (scope.tools.bash) parts.push("bash");
    if (scope.tools.dispatch) parts.push(`→${scope.entity_capabilities.dispatch_targets.length}`);
    const label = scope.mode === "bonded"
      ? `bonded:${parts.join(" ")}`
      : scope.mode === "bypass" ? `bypass:@${scope.deviceId}` : `none:@${scope.deviceId}`;
    ctx.ui.setWorkingMessage(`${entity} · ${label}`);
  });

  pi.events.emit("koad-io:bond-scope", scope);
}
