// koad:io bond-gate extension for the Pi harness.
//
// Gates every tool call against the entity's trust bonds or harness env vars.
// No bond = no permissions. Scope derives from bond capabilities on disk.
//
// Resolution order:
//   1. KOAD_IO_BOND_GATE_BYPASS=1           → disable the gate (explicit dev escape hatch)
//   2. ~/.<entity>/trust/bonds/*.md(.asc)   → derive scope from bond capabilities frontmatter
//   3. KOAD_IO_ENTITY_SCOPE=<bond-type>     → reuse the built-in bond-type scope map
//   4. KOAD_IO_HARNESS_{READ,WRITE,EXEC}_PATHS → custom colon-separated path prefixes
//   5. No match                             → empty scope, everything blocked
//
// Modes:
//   - bonded   → current trust-bond behaviour
//   - env-var  → easy-mode entry for learners and unbonded entities
//   - bypass   → explicit debug/dev escape hatch; never default
//
// Architecture:
//   - session_start: resolve scope + log active mode
//   - tool_call: validate tool + args against permissions
//   - Blocked calls get { block: true, reason } — tool never executes

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Bond types and their file-system permissions
// ---------------------------------------------------------------------------

type BondType = "authorized-agent" | "authorized-builder" | "authorized-specialist" | "peer" | "unknown";
type ScopedBondType = Exclude<BondType, "unknown">;

interface BondScope {
  read: string[];    // allowed read prefixes
  write: string[];   // allowed write/edit prefixes
  exec: string[];    // allowed working directories for bash
  blocked: string[]; // explicitly blocked even within read/write scope
}

interface GateResolution {
  mode: "bypass" | "bonded" | "env-var" | "default";
  label: string;
  scope: BondScope;
  bonds: ParsedBond[];
}

const HOME = os.homedir();
const FORGE_DIR = path.join(HOME, ".forge");
const DEFAULT_BLOCKED = ["/.env", "/.credentials", "/id/", "/trust/"];
const SCOPED_BOND_TYPES: ScopedBondType[] = [
  "authorized-agent",
  "authorized-builder",
  "authorized-specialist",
  "peer",
];

const SCOPE: Record<BondType, BondScope> = {
  "authorized-agent": {
    read: [HOME],
    write: [HOME],
    exec: [HOME],
    blocked: [],
  },
  "authorized-builder": {
    read: [
      FORGE_DIR,
      HOME, // for entity dirs (read briefs/memories)
    ],
    write: [
      FORGE_DIR,
      // own entity dir added dynamically
    ],
    exec: [
      FORGE_DIR,
      // own entity dir added dynamically
    ],
    blocked: [
      // no writing to secrets/keys
      "/.env", "/.credentials", "/id/", "/trust/", "/.git/",
    ],
  },
  "authorized-specialist": {
    read: [
      FORGE_DIR,
      HOME, // for entity dirs
    ],
    write: [
      // own entity dir added dynamically
    ],
    exec: [
      // own entity dir added dynamically
    ],
    blocked: [...DEFAULT_BLOCKED],
  },
  "peer": {
    read: [
      // own entity dir added dynamically
    ],
    write: [
      // own entity dir added dynamically
    ],
    exec: [
      // own entity dir added dynamically
    ],
    blocked: [...DEFAULT_BLOCKED],
  },
  "unknown": {
    read: [],
    write: [],
    exec: [],
    blocked: [],
  },
};

function cloneScope(scope: BondScope): BondScope {
  return {
    read: [...scope.read],
    write: [...scope.write],
    exec: [...scope.exec],
    blocked: [...scope.blocked],
  };
}

function emptyScope(): BondScope {
  return { read: [], write: [], exec: [], blocked: [...DEFAULT_BLOCKED] };
}

function withOwnEntityAccess(entity: string, baseScope: BondScope): BondScope {
  const ownDir = path.join(HOME, `.${entity}`);
  const scope = cloneScope(baseScope);

  if (!isUnder(ownDir, scope.read)) {
    scope.read.push(ownDir);
  }
  if (!isUnder(ownDir, scope.write)) {
    scope.write.push(ownDir);
  }
  if (!isUnder(ownDir, scope.exec)) {
    scope.exec.push(ownDir);
  }

  return scope;
}

function scopeForBondType(entity: string, type: ScopedBondType): BondScope {
  return withOwnEntityAccess(entity, SCOPE[type]);
}

function parseBondType(raw: string | undefined): ScopedBondType | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase().replace(/[^a-z-]/g, "-");
  return SCOPED_BOND_TYPES.find(type => type === normalized);
}

function expandConfiguredPath(rawPath: string): string {
  if (rawPath === "~") return HOME;
  if (rawPath.startsWith("~/")) return path.join(HOME, rawPath.slice(2));
  return path.resolve(rawPath);
}

function parsePathList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(":")
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(expandConfiguredPath);
}

// ---------------------------------------------------------------------------
// Parse bonds from ~/.<entity>/trust/bonds/
// ---------------------------------------------------------------------------

interface BondCapabilities {
  read: string[];
  write: string[];
  exec: string[];
  blocked: string[];
}

interface ParsedBond {
  type: string;
  from: string;
  to: string;
  path: string;
  capabilities?: BondCapabilities;
}

function parseYamlList(block: string, key: string): string[] {
  const keyPattern = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m");
  const match = block.match(keyPattern);
  if (!match) return [];

  const inlineValue = match[1].trim();
  // inline empty: `exec: []`
  if (inlineValue === "[]") return [];
  // inline single value: `exec: [/home/koad]`
  if (inlineValue.startsWith("[")) {
    return inlineValue.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
  }
  // inline single string: `exec: /home/koad`
  if (inlineValue) return [inlineValue];

  // multi-line list: indented `- value` lines following the key
  const lines = block.split("\n");
  const keyLineIdx = lines.findIndex(l => keyPattern.test(l));
  if (keyLineIdx === -1) return [];

  const items: string[] = [];
  for (let i = keyLineIdx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    } else if (lines[i].match(/^\s+\S+:/)) {
      break; // next key at same or higher level
    } else if (lines[i].trim() === "") {
      continue;
    } else {
      break;
    }
  }
  return items;
}

function parseCapabilitiesFromFrontmatter(fm: string): BondCapabilities | undefined {
  if (!fm.includes("capabilities:")) return undefined;

  // extract the capabilities block (from `capabilities:` to next top-level key or end)
  const capStart = fm.indexOf("capabilities:");
  const afterCap = fm.slice(capStart);
  const lines = afterCap.split("\n");
  let capBlock = lines[0] + "\n";
  for (let i = 1; i < lines.length; i++) {
    // stop at next top-level key (no leading whitespace)
    if (lines[i].match(/^\S/) && lines[i].includes(":")) break;
    capBlock += lines[i] + "\n";
  }

  const read = parseYamlList(capBlock, "read").map(expandConfiguredPath);
  const write = parseYamlList(capBlock, "write").map(expandConfiguredPath);
  const exec = parseYamlList(capBlock, "exec").map(expandConfiguredPath);
  const blocked = parseYamlList(capBlock, "blocked");

  return { read, write, exec, blocked };
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
        let type: string = "unknown";
        let from = "";
        let to = entity;
        let capabilities: BondCapabilities | undefined;

        if (fmMatch) {
          const fm = fmMatch[1];
          const typeMatch = fm.match(/^type:\s*(.+)$/m);
          const fromMatch = fm.match(/^from:\s*(.+)$/m);
          const toMatch = fm.match(/^to:\s*(.+)$/m);

          if (typeMatch) {
            type = typeMatch[1].trim();
          }
          if (fromMatch) from = fromMatch[1].trim();
          if (toMatch) to = toMatch[1].trim();

          capabilities = parseCapabilitiesFromFrontmatter(fm);
        }

        bonds.push({ type, from, to, path: path.join(bondsDir, entry), capabilities });
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
// Derive effective scope from bonds / env vars
// ---------------------------------------------------------------------------

function effectiveScope(entity: string, bonds: ParsedBond[]): BondScope {
  if (bonds.length === 0) {
    return emptyScope();
  }

  // Merge scope across all bonds: union of all grants, union of all blocks.
  // If a bond declares capabilities in its frontmatter, use those directly.
  // If a bond only has a recognized type (no capabilities), use the static map.
  // Bonds with unrecognized types and no capabilities contribute nothing.
  const merged: BondScope = { read: [], write: [], exec: [], blocked: [] };
  let anyContributed = false;

  for (const b of bonds) {
    let scope: BondScope | undefined;

    if (b.capabilities) {
      scope = {
        read: [...b.capabilities.read],
        write: [...b.capabilities.write],
        exec: [...b.capabilities.exec],
        blocked: [...b.capabilities.blocked],
      };
    } else {
      const knownType = parseBondType(b.type);
      if (knownType) {
        scope = scopeForBondType(entity, knownType);
      }
    }

    if (scope) {
      anyContributed = true;
      for (const p of scope.read) if (!merged.read.includes(p)) merged.read.push(p);
      for (const p of scope.write) if (!merged.write.includes(p)) merged.write.push(p);
      for (const p of scope.exec) if (!merged.exec.includes(p)) merged.exec.push(p);
      for (const p of scope.blocked) if (!merged.blocked.includes(p)) merged.blocked.push(p);
    }
  }

  return anyContributed ? merged : emptyScope();
}

function customScopeFromEnv(): BondScope | undefined {
  const read = parsePathList(process.env.KOAD_IO_HARNESS_READ_PATHS);
  const write = parsePathList(process.env.KOAD_IO_HARNESS_WRITE_PATHS);
  const exec = parsePathList(process.env.KOAD_IO_HARNESS_EXEC_PATHS);

  if (read.length === 0 && write.length === 0 && exec.length === 0) {
    return undefined;
  }

  return {
    read,
    write,
    exec,
    blocked: [...DEFAULT_BLOCKED],
  };
}

function resolveGate(entity: string): GateResolution {
  const bypass = process.env.KOAD_IO_BOND_GATE_BYPASS === "1" || process.env.KOAD_IO_PI_BOND_GATE_BYPASS === "1";
  if (bypass) {
    return {
      mode: "bypass",
      label: "mode=bypass — ALL ACCESS GRANTED",
      scope: { read: ["/"], write: ["/"], exec: ["/"], blocked: [] },
      bonds: [],
    };
  }

  const bonds = parseBonds(entity);
  if (bonds.length > 0) {
    return {
      mode: "bonded",
      label: `mode=bonded bonds=${bonds.length}`,
      scope: effectiveScope(entity, bonds),
      bonds,
    };
  }

  const envScope = parseBondType(process.env.KOAD_IO_ENTITY_SCOPE);
  if (envScope) {
    return {
      mode: "env-var",
      label: `mode=env-var scope=${envScope}`,
      scope: scopeForBondType(entity, envScope),
      bonds,
    };
  }

  const customScope = customScopeFromEnv();
  if (customScope) {
    return {
      mode: "env-var",
      label: "mode=env-var custom",
      scope: customScope,
      bonds,
    };
  }

  return {
    mode: "default",
    label: "mode=default — no bonds, no permissions",
    scope: emptyScope(),
    bonds: [],
  };
}

// ---------------------------------------------------------------------------
// Path check helpers
// ---------------------------------------------------------------------------

function isUnder(absolutePath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => {
    const resolvedPrefix = path.resolve(prefix);
    const relative = path.relative(resolvedPrefix, absolutePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function isBlocked(absolutePath: string, blocked: string[]): boolean {
  // blocked patterns match anywhere in the path (e.g. "/id/" anywhere)
  // Normalize to always check with trailing slash for directory patterns
  const normalized = absolutePath + "/";
  return blocked.some(pattern => normalized.includes(pattern));
}

// ---------------------------------------------------------------------------
// Daemon audit emission (fire-and-forget)
// ---------------------------------------------------------------------------

function bondBlockReason(entity: string, toolName: string, detail: string, scope?: BondScope): string {
  const now = new Date().toISOString();
  const lines = [
    `koad:io bond gate — blocked`,
    `  time:    ${now}`,
    `  entity:  ${entity}`,
    `  tool:    ${toolName}`,
    `  reason:  ${detail}`,
  ];
  if (scope) {
    const readDirs = scope.read.map(dir => dir.replace(HOME, "~")).join(", ");
    const writeDirs = scope.write.map(dir => dir.replace(HOME, "~")).join(", ");
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

function logMode(ctx: any, message: string, level: "info" | "warning" = "info"): void {
  const line = `[bond-gate] ${message}`;
  if (level === "warning") {
    console.warn(line);
  } else {
    console.log(line);
  }
  if (ctx.hasUI) {
    ctx.ui.notify(line, level);
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const entity = process.env.ENTITY ?? "";
  if (!entity) {
    console.warn("[bond-gate] ENTITY unset — gate disabled");
    return;
  }

  let gate = resolveGate(entity);

  // -----------------------------------------------------------------------
  // session_start: load bonds/env and build scope
  // -----------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    gate = resolveGate(entity);

    const requestedScope = process.env.KOAD_IO_ENTITY_SCOPE;
    if (requestedScope && !parseBondType(requestedScope) && gate.mode !== "bonded") {
      logMode(ctx, `invalid KOAD_IO_ENTITY_SCOPE=${requestedScope} — ignoring`, "warning");
    }

    logMode(ctx, gate.label, gate.mode === "bypass" ? "warning" : "info");
  });

  // -----------------------------------------------------------------------
  // tool_call: validate every tool invocation
  // -----------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;
    const scope = gate.scope;

    if (gate.mode === "bypass") {
      return undefined;
    }

    // Resolve the path argument for file-oriented tools
    const rawPath = (input as Record<string, unknown>)?.path as string | undefined;

    let absolutePath: string | undefined;
    if (rawPath) {
      absolutePath = path.resolve(ctx.cwd, rawPath);
    }

    // --- read ---
    if (toolName === "read") {
      if (scope.read.length === 0) {
        auditBlock(entity, "read", rawPath ?? "", "no read permissions granted by bond");
        return { block: true, reason: bondBlockReason(entity, "read", "no bond grants read permissions", scope) };
      }
      if (absolutePath && !isUnder(absolutePath, scope.read)) {
        auditBlock(entity, "read", rawPath!, "outside read scope");
        return { block: true, reason: bondBlockReason(entity, "read", `${rawPath} is outside bond scope`) };
      }
      return undefined;
    }

    // --- write / edit ---
    if (toolName === "write" || toolName === "edit") {
      if (scope.write.length === 0) {
        auditBlock(entity, toolName, rawPath ?? "", "no write permissions granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants write permissions", scope) };
      }
      if (absolutePath) {
        if (isBlocked(absolutePath, scope.blocked)) {
          auditBlock(entity, toolName, rawPath!, "blocked path pattern");
          if (ctx.hasUI) ctx.ui.notify(`Blocked ${toolName}: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is a protected path`) };
        }
        if (!isUnder(absolutePath, scope.write)) {
          auditBlock(entity, toolName, rawPath!, "outside write scope");
          if (ctx.hasUI) ctx.ui.notify(`koad:io bond gate — ${toolName} blocked: ${rawPath}`, "warning");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is outside bond scope`, scope) };
        }
      }
      return undefined;
    }

    // --- bash ---
    if (toolName === "bash") {
      const command = ((input as Record<string, unknown>)?.command as string | undefined) ?? "";

      // No exec paths granted → bash is not available
      if (scope.exec.length === 0) {
        auditBlock(entity, "bash", command.slice(0, 80), "no exec permissions granted by bond");
        return { block: true, reason: bondBlockReason(entity, "bash", "no bond grants exec permissions", scope) };
      }

      // Always block dangerous patterns regardless of bond
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
          return { block: true, reason: bondBlockReason(entity, "bash", `dangerous command pattern detected`) };
        }
      }

      // Validate cwd is within exec scope
      if (!isUnder(ctx.cwd, scope.exec)) {
        auditBlock(entity, "bash", ctx.cwd, "cwd outside exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", `working directory outside bond scope`) };
      }

      return undefined;
    }

    // --- find / grep / ls — allow if within read scope ---
    if (toolName === "find" || toolName === "grep" || toolName === "ls") {
      if (scope.read.length === 0) {
        auditBlock(entity, toolName, rawPath ?? "", "no read permissions granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants read permissions", scope) };
      }
      if (absolutePath && !isUnder(absolutePath, scope.read)) {
        return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is outside bond scope`, scope) };
      }
      return undefined;
    }

    // Default deny — if the bond doesn't grant it, it's blocked
    auditBlock(entity, toolName, "", "tool not granted by any bond");
    return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants access to this tool", scope) };
  });

  // -----------------------------------------------------------------------
  // before_agent_start: inject bond scope into system prompt
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", (_event, ctx) => {
    gate = resolveGate(entity);
    const dirs = [...new Set([...gate.scope.write, ...gate.scope.read])];
    ctx.ui.setWorkingMessage(
      `bond-gate · ${entity} · ${gate.label} · paths: ${dirs.map(dir => dir.replace(HOME, "~")).join(", ")}`,
    );
  });
}
