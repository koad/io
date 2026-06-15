// koad:io bond-gate — registerBondGate() entry point.
//
// Two modes:
//   1. Entity mode (default): gates tool calls against trust bonds on disk.
//      Bonds are signed capability grants from one entity to another.
//   2. Visitor mode: gates tool calls against a provided access scope.
//      Used by SDK / RPC for public visitors and bonded callers.
//
// In visitor mode, ecosystem tools are denied for public visitors,
// and all tool results are scrubbed for secrets in ALL modes
// (sessions are published to kingofalldata.com in real time).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { getDDP } from "../ddp";
import type { DDPClient, DDPEvent, BondRecord } from "../ddp";
import {
  type BondScope,
  type VisitorConfig,
  GLOBAL_ALLOWED_TOOLS, SCOPED_SEARCH_TOOLS, FILE_READ_TOOLS, FILE_WRITE_TOOLS, SHELL_TOOLS,
  GATED_DISPATCH_TOOLS, KOADIO_TOOLS, PI_BUILTIN_TOOLS,
  isUnder, isBlocked, resolveToolPath, HOME,
  log, logMode,
} from "./types";
import { resolveGate, bondBlockReason, auditBlock } from "./resolve";
import { inspectBashCommand } from "./bash-policy";
import { inputLooksSensitive, scrubToolResult } from "./scrub";

// ---------------------------------------------------------------------------
// Entity-mode helpers
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
    envLanes: scope.envLanes,
    envReadTools: scope.envReadTools,
    envWriteTools: scope.envWriteTools,
  });
}

function scopeStatus(scope: BondScope): string {
  const env = scope.envLanes.length > 0 ? ` · env ${scope.envLanes.join(",")}` : "";
  if (scope.mode === "bypass") return `bypass · device ${scope.deviceId}${env}`;
  if (scope.errors.length > 0) {
    return `⚠ bonds: ${scope.errors[0]}${scope.errors.length > 1 ? ` (+${scope.errors.length - 1} more)` : ""} · device ${scope.deviceId}${env}`;
  }
  return `${scope.bondCount} bond${scope.bondCount !== 1 ? "s" : ""} · r${scope.file.read.length} w${scope.file.write.length} e${scope.file.exec.length} · device ${scope.deviceId}${env}`;
}

// ---------------------------------------------------------------------------
// registerBondGate — unified entry point
// ---------------------------------------------------------------------------

export function registerBondGate(
  pi: ExtensionAPI,
  ddp?: DDPClient | null,
  visitor?: VisitorConfig | null,
) {
  ddp ??= getDDP();
  const entity = visitor?.entityHandle ?? process.env.ENTITY ?? "";
  const isVisitor = !!visitor;
  const isPublicVisitor = isVisitor && !visitor!.caller;

  if (!entity) {
    log("ENTITY unset — gate disabled");
    return;
  }

  // ── Entity mode: resolve from bond files ──────────────────────
  let scope = resolveGate(entity, false);
  let lastCtx: any;
  let lastHasUI = false;

  const updateStatus = (): void => {
    if (lastCtx?.hasUI) {
      lastCtx.ui.setStatus("bond-gate", isVisitor ? `visitor · ${entity}` : scopeStatus(scope));
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
    const readPaths = isVisitor ? (visitor!.accessScope.read ?? []) : scope.file.read;
    for (const rawRoot of readPaths) {
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

  // ── Block helpers (shared between entity and visitor) ────────
  function block(reason: string) {
    return { block: true, reason };
  }

  function visitorEcosystemDeny(toolName: string) {
    if (!isVisitor || visitor!.caller) return undefined;
    return block(`${toolName} is not available to public visitors`);
  }

  function visitorDispatchDeny(toolName: string) {
    if (!isVisitor) return undefined;
    if (visitor!.caller) return undefined; // bonded callers could theoretically dispatch
    return block(`${toolName} is not available to public visitors`);
  }

  // ── DDP bond monitoring (entity mode only) ───────────────────
  if (ddp && !isVisitor) {
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
    if (!isVisitor) rebuildScope(ctx.hasUI);
    updateStatus();
    if (!isVisitor) {
      logMode(ctx, scope.label, scope.mode === "bypass" ? "warning" : "info");
      if (scope.errors.length > 0) {
        for (const err of scope.errors) {
          ctx.ui.notify(`[bond-gate] ${err}`, "warning");
        }
      }
    } else {
      log(`visitor session: ${entity} caller=${visitor!.caller?.handle ?? "public"}`);
    }
  });

  // -----------------------------------------------------------------------
  // tool_call
  // -----------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;

    lastCtx = ctx;
    if (!isVisitor) rebuildScope(ctx.hasUI);
    const mode = isVisitor ? "visitor" : scope.mode;

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

    // ── Get effective scope (entity bonds or visitor accessScope) ─
    const readScope = isVisitor ? (visitor!.accessScope.read ?? []) : scope.file.read;
    const writeScope = isVisitor ? (visitor!.accessScope.write ?? []) : scope.file.write;
    const execScope = isVisitor ? (visitor!.accessScope.exec ?? []) : scope.file.exec;
    const blockedPaths = isVisitor ? (visitor!.accessScope.blocked ?? []) : scope.file.blocked;

    // ── Shell — exec scope + bash policy ───────────────────────
    if (SHELL_TOOLS.has(toolName)) {
      if (isVisitor && execScope.length === 0) {
        return block("bash is outside visitor exec scope");
      }

      const command = (input as Record<string, unknown>)?.command;
      const bashBlock = inspectBashCommand(command, effectiveCwd, execScope, entity);
      if (bashBlock) {
        auditBlock(entity, "bash", bashBlock.commandSnippet, bashBlock.auditReason);
        return { block: true, reason: bondBlockReason(entity, "bash", bashBlock.detail, scope) };
      }

      if (mode === "bypass") return undefined;

      if (!isVisitor && !scope.tools.bash) {
        log(`BLOCK bash: not granted (mode=${mode})`);
        auditBlock(entity, "bash", "", "bash not granted by any bond");
        return { block: true, reason: bondBlockReason(entity, "bash", "no bond grants bash — set KOAD_IO_BOND_GATE_ALLOW_BASH=1 for a temporary shell lane, or use koad-io tool / ask_question(to=\"koad\") to request shell access", scope) };
      }
      if (execScope.length === 0) {
        auditBlock(entity, "bash", "", "bash granted but no exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", "bash granted but no exec paths — add exec paths to bond capabilities or KOAD_IO_HARNESS_EXEC_PATHS", scope) };
      }
      if (!isUnder(effectiveCwd, execScope)) {
        auditBlock(entity, "bash", effectiveCwd, "cwd outside exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", "working directory outside bond exec scope", scope) };
      }
      return undefined;
    }

    if (mode === "bypass") return undefined;

    // ── Search/discovery tools ─────────────────────────────────
    if (SCOPED_SEARCH_TOOLS.has(toolName)) {
      const ecoDeny = visitorEcosystemDeny(toolName);
      if (ecoDeny) return ecoDeny;

      if (!isVisitor && !hasKoadioGrant(toolName)) {
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

    // ── Read tools ─────────────────────────────────────────────
    if (FILE_READ_TOOLS.has(toolName)) {
      if (readScope.length === 0) {
        const msg = isVisitor ? `${toolName} is outside visitor read scope` : "no bond grants read permissions";
        return block(msg);
      }
      if (!absolutePath) {
        if (!isUnder(effectiveCwd, readScope)) {
          return block(isVisitor ? "working directory is outside visitor read scope" : "working directory outside bond read scope");
        }
        return undefined;
      }
      if (absolutePath && isUnder(effectiveCwd, readScope) && isUnder(absolutePath, [effectiveCwd])) {
        if (isBlocked(absolutePath, blockedPaths)) {
          return block(`${pathArg} is protected`);
        }
        return undefined;
      }
      if (isBlocked(absolutePath, blockedPaths)) {
        return block(`${pathArg} is protected`);
      }
      if (!isUnder(absolutePath, readScope)) {
        return block(isVisitor ? `${pathArg} is outside visitor read scope` : `${pathArg} is outside bond scope`);
      }
      return undefined;
    }

    // ── Ecosystem tools ────────────────────────────────────────
    if (isEcosystemTool(toolName)) {
      const ecoDeny = visitorEcosystemDeny(toolName);
      if (ecoDeny) return ecoDeny;

      if (isVisitor) return undefined; // bonded visitors pass through

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

    // ── Dispatch tools ─────────────────────────────────────────
    if (GATED_DISPATCH_TOOLS.has(toolName)) {
      const dispDeny = visitorDispatchDeny(toolName);
      if (dispDeny) return dispDeny;

      if (isVisitor) return undefined;

      const dispatchGranted = toolName === "dispatch"
        ? scope.tools.dispatch
        : toolName === "dispatch_followup"
          ? (scope.tools.dispatch_followup || scope.tools.dispatch)
          : (scope.tools.dispatch_complete || scope.tools.dispatch);
      if (!dispatchGranted) {
        log(`BLOCK ${toolName}: not granted (mode=${mode})`);
        return { block: true, reason: bondBlockReason(entity, toolName, `${toolName} not granted by bond — set the matching KOAD_IO_BOND_GATE_ALLOW_* lane or use ask_question(to=\"koad\") to request`, scope) };
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

    // ── Write tools ────────────────────────────────────────────
    if (FILE_WRITE_TOOLS.has(toolName)) {
      // ── Protected filenames: block write/edit, allow append ──
      //
      // The scrubber redacts secrets from read results. If the LLM
      // then tries to write/edit a file it can't read (like .env),
      // it would overwrite the file blindly — destroying secrets.
      // append is safe: it adds lines without needing to see contents.
      //
      // Patterns are matched against the basename of the target path.
      if (absolutePath && (toolName === "write" || toolName === "edit")) {
        const basename = path.basename(absolutePath);
        const protectedPatterns = [
          /^\.env(\..*)?$/,          // .env, .env.local, .env.production
          /^\.credentials(\..*)?$/,  // .credentials, .credentials.local
          /^credentials(\..*)?$/,    // credentials, credentials.json
          /^secret(s)?(\..*)?$/i,    // secret, secrets, secrets.yaml
          /^\..*key(\.pem)?$/,       // .id_rsa, .ssh-key, .key.pem
          /^\..*token$/i,            // .github-token, .api-token
          /^id_rsa$/,                // raw SSH private key
          /^id_ed25519$/,            // raw SSH private key
        ];
        const isProtected = protectedPatterns.some((re) => re.test(basename));
        if (isProtected) {
          log(`BLOCK ${toolName} ${absolutePath}: protected filename`);
          auditBlock(entity, toolName, absolutePath, "protected filename — write/edit blocked, use append");
          const safeMethod = "append";
          return {
            block: true,
            reason:
              `${rawPath} is a protected file — its contents are redacted in read results, ` +
              `so a blind write or edit would destroy any existing secrets. ` +
              `Use the \`${safeMethod}\` tool to add new lines without overwriting. ` +
              `If you need to modify an existing line, ask the user to do it manually.`,
          };
        }
      }

      if (writeScope.length === 0) {
        const msg = isVisitor ? `${toolName} is outside visitor write scope` : "no bond grants write permissions";
        return block(msg);
      }
      if (absolutePath) {
        if (isBlocked(absolutePath, blockedPaths)) {
          if (ctx.hasUI) ctx.ui.notify(`Blocked ${toolName}: ${rawPath}`, "warning");
          return block(`${rawPath} is protected`);
        }
        if (!isUnder(absolutePath, writeScope)) {
          if (ctx.hasUI) ctx.ui.notify(`koad:io bond gate — ${toolName} blocked: ${rawPath}`, "warning");
          return block(isVisitor ? `${rawPath} is outside visitor write scope` : `${rawPath} is outside bond scope`);
        }
      }
      return undefined;
    }

    log(`BLOCK ${toolName}: unrecognized (mode=${mode})`);
    auditBlock(entity, toolName, "", "unrecognized tool");
    return { block: true, reason: bondBlockReason(entity, toolName, "unrecognized tool — use koad-io tool or ask_question(to=\"koad\") to request capability expansion", scope) };
  });

  // -----------------------------------------------------------------------
  // tool_result — scrub secrets before the LLM ever sees them
  //
  // Entities operate with least privilege. If a tool result contains
  // a secret (private key, token, password, protected path), the entity
  // shouldn't see it either. Scrubbing at tool_result is the last line
  // of defense — the LLM gets clean content, and so does the published
  // session on kingofalldata.com.
  //
  // Set KOAD_IO_SKIP_SCRUB=1 to disable (debugging / trusted sessions).
  // -----------------------------------------------------------------------

  if (process.env.KOAD_IO_SKIP_SCRUB !== "1") {
    pi.on("tool_result", async (event) => {
      // If the tool input itself targets sensitive paths or commands, redact entirely
      if (inputLooksSensitive(event.input)) {
        return {
          content: [{ type: "text", text: "[redacted sensitive tool result]" }],
          details: { redacted: true, reason: "protected-source" },
          isError: event.isError,
        };
      }

      const scrubbed = scrubToolResult(event.content, event.details, event.isError);
      if (scrubbed) {
        return {
          content: scrubbed.content,
          details: scrubbed.details,
          isError: scrubbed.isError ?? event.isError,
        };
      }

      return undefined;
    });
  }

  // -----------------------------------------------------------------------
  // before_agent_start: inject scope summary into system prompt
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", (_event, ctx) => {
    lastCtx = ctx;
    if (!isVisitor) rebuildScope(ctx.hasUI);

    if (isVisitor) {
      const callerLabel = visitor!.caller?.handle ?? "public";
      const label = `visitor:${callerLabel} → ${entity} r${readScope.length} w${writeScope.length} e${execScope.length}`;
      ctx.ui.setWorkingMessage(label);
    } else {
      const parts = [
        `${scope.bondCount}b`,
        `r${scope.file.read.length} w${scope.file.write.length} e${scope.file.exec.length}`,
        `@${scope.deviceId}`,
      ];
      if (scope.tools.bash) parts.push("bash");
      if (scope.tools.dispatch) parts.push(`→${scope.entity_capabilities.dispatch_targets.length}`);
      if (scope.envLanes.length > 0) parts.push(`env+${scope.envLanes.length}`);
      const label = scope.mode === "bonded"
        ? `bonded:${parts.join(" ")}`
        : scope.mode === "bypass"
          ? `bypass:@${scope.deviceId}`
          : scope.mode === "env-var"
            ? `env:${parts.join(" ")}`
            : `none:@${scope.deviceId}`;
      ctx.ui.setWorkingMessage(`${entity} · ${label}`);
    }
  });

  if (!isVisitor) {
    pi.events.emit("koad-io:bond-scope", scope);
  }
}
