// koad-io bond-gate extension for the Pi harness.
//
// Gates every tool call against the entity's trust bonds.
// Loads bonds from ~/.<entity>/trust/bonds/*.md.asc at session_start.
// Blocks reads/writes/exec outside authorized scope.
//
// Architecture:
//   - session_start: parse bonds, build permission bitmap
//   - tool_call: validate tool + args against permissions
//   - Blocked calls get { block: true, reason } — tool never executes
//   - Fallback: no bonds = restricted default scope (entity dir + forge readonly)
//
// Trust bond types → tool permissions:
//   authorized-agent:   full koad:io scope (forge, all entity dirs, framework)
//   authorized-builder: read/write forge + own entity dir, read other entity briefs/memories
//   authorized-specialist: read/write own entity dir, read forge
//   peer:               read own entity dir, read other entity briefs/memories

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Bond types and their file-system permissions
// ---------------------------------------------------------------------------

type BondType = "authorized-agent" | "authorized-builder" | "authorized-specialist" | "peer" | "unknown";

interface BondScope {
  read: string[];    // allowed read prefixes
  write: string[];   // allowed write/edit prefixes
  exec: string[];    // allowed working directories for bash
  blocked: string[]; // explicitly blocked even within read/write scope
}

const HOME = os.homedir();

const SCOPE: Record<BondType, BondScope> = {
  "authorized-agent": {
    read: [HOME],
    write: [HOME],
    exec: [HOME],
    blocked: [],
  },
  "authorized-builder": {
    read: [
      path.join(HOME, ".forge"),
      HOME, // for entity dirs (read briefs/memories)
    ],
    write: [
      path.join(HOME, ".forge"),
      // own entity dir added dynamically
    ],
    exec: [
      path.join(HOME, ".forge"),
      // own entity dir added dynamically
    ],
    blocked: [
      // no writing to secrets/keys
      "/.env", "/.credentials", "/id/", "/trust/", "/.git/",
    ],
  },
  "authorized-specialist": {
    read: [
      path.join(HOME, ".forge"),
      HOME, // for entity dirs
    ],
    write: [
      // own entity dir added dynamically
    ],
    exec: [
      // own entity dir added dynamically
    ],
    blocked: [
      "/.env", "/.credentials", "/id/", "/trust/",
    ],
  },
  "peer": {
    read: [
      // own entity dir + shared briefs/memories added dynamically
    ],
    write: [
      // own entity dir added dynamically
    ],
    exec: [
      // own entity dir added dynamically
    ],
    blocked: [
      "/.env", "/.credentials", "/id/", "/trust/",
    ],
  },
  "unknown": {
    read: [],
    write: [],
    exec: [],
    blocked: [],
  },
};

// ---------------------------------------------------------------------------
// Parse bonds from ~/.<entity>/trust/bonds/
// ---------------------------------------------------------------------------

interface ParsedBond {
  type: BondType;
  from: string;
  to: string;
  path: string;
}

function parseBonds(entity: string): ParsedBond[] {
  const bondsDir = path.join(HOME, `.${entity}`, "trust", "bonds");
  const bonds: ParsedBond[] = [];

  try {
    const entries = fs.readdirSync(bondsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md.asc") && !entry.endsWith(".md")) continue;
      try {
        const content = fs.readFileSync(path.join(bondsDir, entry), "utf-8");
        // GPG clearsigned: strip the PGP armor, keep the markdown body
        const body = content
          .replace(/^-----BEGIN PGP SIGNED MESSAGE-----\s*/m, "")
          .replace(/^-----BEGIN PGP SIGNATURE-----[\s\S]*$/m, "")
          .replace(/^Hash:.*\n/m, "")
          .trim();

        // Extract frontmatter if present
        const fmMatch = body.match(/^---\s*\n([\s\S]*?)\n---/);
        let type: BondType = "unknown";
        let from = "";
        let to = entity;

        if (fmMatch) {
          const fm = fmMatch[1];
          const typeMatch = fm.match(/^type:\s*(.+)$/m);
          const fromMatch = fm.match(/^from:\s*(.+)$/m);
          const toMatch = fm.match(/^to:\s*(.+)$/m);

          if (typeMatch) {
            const raw = typeMatch[1].trim().toLowerCase().replace(/[^a-z-]/g, "-");
            if (raw in SCOPE) type = raw as BondType;
          }
          if (fromMatch) from = fromMatch[1].trim();
          if (toMatch) to = toMatch[1].trim();
        }

        bonds.push({ type, from, to, path: path.join(bondsDir, entry) });
      } catch (_) {
        // skip unreadable bonds
      }
    }
  } catch (_) {
    // no bonds directory
  }

  return bonds;
}

// ---------------------------------------------------------------------------
// Derive effective scope from bonds
// ---------------------------------------------------------------------------

function effectiveScope(entity: string, bonds: ParsedBond[]): BondScope {
  if (bonds.length === 0) {
    // No bonds — apply a minimal safe default
    const ownDir = path.join(HOME, `.${entity}`);
    return {
      read: [ownDir],
      write: [ownDir],
      exec: [ownDir],
      blocked: ["/.env", "/.credentials", "/id/", "/trust/"],
    };
  }

  // Take the highest-authority bond type
  const order: BondType[] = ["authorized-agent", "authorized-builder", "authorized-specialist", "peer"];
  let highest: BondType = "unknown";
  for (const b of bonds) {
    const bi = order.indexOf(b.type);
    const hi = order.indexOf(highest);
    if (bi !== -1 && (hi === -1 || bi < hi)) highest = b.type;
  }

  const scope = { ...SCOPE[highest] };
  const ownDir = path.join(HOME, `.${entity}`);

  // Dynamically add own entity dir to write/exec if not already covered
  if (!scope.write.some(p => ownDir.startsWith(p))) {
    scope.write = [...scope.write, ownDir];
  }
  if (!scope.exec.some(p => ownDir.startsWith(p))) {
    scope.exec = [...scope.exec, ownDir];
  }

  return scope;
}

// ---------------------------------------------------------------------------
// Path check helpers
// ---------------------------------------------------------------------------

function isUnder(absolutePath: string, prefixes: string[]): boolean {
  return prefixes.some(p => absolutePath.startsWith(p));
}

function isBlocked(absolutePath: string, blocked: string[]): boolean {
  // blocked patterns match anywhere in the path (e.g. "/id/" anywhere)
  // Normalize to always check with trailing slash for directory patterns
  const normalized = absolutePath + "/";
  return blocked.some(b => normalized.includes(b));
}

// ---------------------------------------------------------------------------
// Daemon audit emission (fire-and-forget)
// ---------------------------------------------------------------------------

function bondBlockReason(toolName: string, detail: string, scope?: BondScope): string {
  const now = new Date().toISOString();
  const lines = [
    `koad:io bond gate — blocked`,
    `  time:    ${now}`,
    `  entity:  ${entity}`,
    `  tool:    ${toolName}`,
    `  reason:  ${detail}`,
  ];
  if (scope) {
    const readDirs = scope.read.map(d => d.replace(HOME, "~")).join(", ");
    const writeDirs = scope.write.map(d => d.replace(HOME, "~")).join(", ");
    lines.push(`  scope:`);
    lines.push(`    read:  ${readDirs || "(none)"}`);
    lines.push(`    write: ${writeDirs || "(none)"}`);
  }
  lines.push(`  action: use ask_question(to="koad") to request expanded permissions`);
  return lines.join("\n");
}

function auditBlock(entity: string, toolName: string, pathArg: string, reason: string): void {
  const daemonUrl = process.env.KOAD_IO_DAEMON_URL ?? "http://10.10.10.10:28282";
  const emitEnabled = process.env.KOAD_IO_EMIT === "1";
  if (!emitEnabled) return;
  fetch(`${daemonUrl}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity,
      type: "tool.blocked",
      body: `${entity}: ${toolName} ${pathArg} blocked — ${reason}`,
      timestamp: new Date().toISOString(),
      meta: {
        payload: { tool: toolName, path: pathArg, reason, bondGate: true },
      },
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const experimental = process.env.KOAD_IO_EXPERIMENTAL === "1";
  if (!experimental) return;


	return; // this is too hard right now,. need evolution to take place first.	


  const entity = process.env.ENTITY ?? "";
  const bypass = process.env.KOAD_IO_PI_BOND_GATE_BYPASS === "1" || process.env.KOAD_IO_SPIRIT === "koad";
  let scope: BondScope = SCOPE.unknown;

  // -----------------------------------------------------------------------
  // session_start: load bonds and build scope
  // -----------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    if (bypass) {
      scope = { read: [HOME], write: [HOME], exec: [HOME], blocked: [] };
      if (ctx.hasUI) ctx.ui.notify(`bond-gate: BYPASS active for ${entity}`, "warning");
      return;
    }

    const bonds = parseBonds(entity);
    scope = effectiveScope(entity, bonds);

    if (bonds.length === 0 && ctx.hasUI) {
      ctx.ui.notify(
        `bond-gate: no bonds found for ${entity} — restricted to own directory`,
        "warning",
      );
    } else if (bonds.length > 0 && ctx.hasUI) {
      const types = [...new Set(bonds.map(b => b.type))].join(", ");
      ctx.ui.notify(`bond-gate: loaded ${bonds.length} bond(s) [${types}]`, "info");
    }
  });

  // -----------------------------------------------------------------------
  // tool_call: validate every tool invocation
  // -----------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;

    // Resolve the path argument for file-oriented tools
    const rawPath: string | undefined =
      (input as Record<string, unknown>)?.path as string;

    let absolutePath: string | undefined;
    if (rawPath) {
      absolutePath = path.resolve(ctx.cwd, rawPath);
    }

    // --- read ---
    if (toolName === "read") {
      if (absolutePath && !isUnder(absolutePath, scope.read)) {
        auditBlock(entity, "read", rawPath!, "outside read scope");
        return { block: true, reason: bondBlockReason("read", `${rawPath} is outside bond scope`) };
      }
      return undefined;
    }

    // --- write / edit ---
    if (toolName === "write" || toolName === "edit") {
      if (absolutePath) {
        if (isBlocked(absolutePath, scope.blocked)) {
          auditBlock(entity, toolName, rawPath!, "blocked path pattern");
          if (ctx.hasUI) ctx.ui.notify(`Blocked ${toolName}: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(toolName, `${rawPath} is a protected path`) };
        }
        if (!isUnder(absolutePath, scope.write)) {
          auditBlock(entity, toolName, rawPath!, "outside write scope");
          if (ctx.hasUI) ctx.ui.notify(`koad:io bond gate — ${toolName} blocked: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(toolName, `${rawPath} is outside bond scope`, scope) };
        }
      }
      return undefined;
    }

    // --- bash ---
    if (toolName === "bash") {
      const command = (input as Record<string, unknown>)?.command as string ?? "";

      // Always block: sudo, chmod 777, recursive rm on root-ish paths
      const dangerous = [
        /\bsudo\b/,
        /\bchmod\b.*777/,
        /\bchown\b/,
        /\brm\s+(-rf?|--recursive)\s+\/(\s|$)/,
        /\brm\s+(-rf?|--recursive)\s+~/,
        />\s*\/dev\//,
      ];

      for (const pattern of dangerous) {
        if (pattern.test(command)) {
          auditBlock(entity, "bash", command.slice(0, 80), "dangerous command pattern");
          if (ctx.hasUI) ctx.ui.notify(`Blocked dangerous command: ${command.slice(0, 60)}`, "error");
          return { block: true, reason: bondBlockReason("bash", `dangerous command pattern detected`) };
        }
      }

      // Validate cwd is within exec scope
      if (!isUnder(ctx.cwd, scope.exec)) {
        auditBlock(entity, "bash", ctx.cwd, "cwd outside exec scope");
        return { block: true, reason: bondBlockReason("bash", `working directory outside bond scope`) };
      }

      return undefined;
    }

    // --- find / grep / ls — allow if within read scope ---
    if (toolName === "find" || toolName === "grep" || toolName === "ls") {
      if (absolutePath && !isUnder(absolutePath, scope.read)) {
        return { block: true, reason: bondBlockReason(toolName, `${rawPath} is outside bond scope`, scope) };
      }
      return undefined;
    }

    // Unknown tools — allow through (extensions own them)
    return undefined;
  });

  // -----------------------------------------------------------------------
  // before_agent_start: inject bond scope into system prompt
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", (_event, ctx) => {
    if (!entity) return;
    // Publish the working directories so the agent knows its bounds.
    // This avoids the agent attempting operations it can't complete.
    const dirs = [...new Set([...scope.write, ...scope.read])];
    ctx.ui.setWorkingMessage(
      `bond-gate · ${entity} · write: ${dirs.map(d => d.replace(HOME, "~")).join(", ")}`,
    );
  });
}
