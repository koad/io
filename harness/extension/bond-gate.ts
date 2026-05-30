// koad:io bond-gate extension for the Pi harness.
//
// Gates every tool call against the entity's trust bonds.
// Bonds are signed capability grants from one entity to another.
//
// What a bond governs:
//   1. File scope      — read/write/exec paths + blocked patterns
//   2. Tool grants     — bash, dispatch, channels, etc.
//   3. Entity caps     — who can be dispatched to, which channels can be moderated
//   4. Interactive mode — broader scope when a human is watching (ctx.hasUI)
//   5. Direction       — bonds apply where `to` matches the running entity
//   6. Status & expiry — ACTIVE/REVOKED/EXPIRED, optional expires date
//
// Resolution order:
//   1. KOAD_IO_BOND_GATE_BYPASS=1 → bypass
//   2. Parse ALL bonds from ~/.<entity>/trust/bonds/*.md(.asc)
//   3. Filter: status=ACTIVE, not expired, to=entity
//   4. Merge: file scope (union), tool grants (any=true), entity caps (union)
//   5. If interactive (ctx.hasUI), merge interactive overrides on top
//   6. No matching bonds → env-var fallback → default (nothing allowed)
//
// Tool classification:
//   - koad:io tools     → gated by bond koadio_tools list
//   - read/find/grep/ls → gated by bond read scope, cwd always readable
//   - write/edit        → gated by bond write scope + blocked patterns
//   - bash              → gated by tool grant + exec scope
//   - dispatch          → gated by tool grant + target in entity_capabilities
//   - unknown           → default deny

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileScope {
  read: string[];
  write: string[];
  exec: string[];
  blocked: string[];
}

interface ToolGrants {
  bash: boolean;
  dispatch: boolean;
  dispatch_followup: boolean;
  dispatch_complete: boolean;
  koadio_tools: string[];
  koadio_commands: string[];
  channels: {
    moderate: string[];
    participate: string[];
  };
}

interface EntityCapabilities {
  dispatch_targets: string[];
  message_targets: string[];
  channel_roles: Record<string, string>;  // channel_slug → role
}

interface InteractiveOverride {
  bash?: boolean;
  exec?: string[];
  write?: string[];
}

interface ParsedBond {
  // Identity
  type: string;
  from: string;
  from_fingerprint?: string;
  to: string;
  status: string;
  visibility: string;
  created?: string;
  expires?: string;
  renewal?: string;

  // File scope
  capabilities: FileScope;

  // Tool grants
  tools: ToolGrants;

  // Entity capabilities
  entity_capabilities: EntityCapabilities;

  // Interactive override
  interactive: InteractiveOverride;

  // Metadata
  path: string;
  specRefs: string[];
  reason?: string;
}

interface BondScope {
  // File scope (merged from all active bonds)
  file: FileScope;

  // Tool grants (any bond granting = true)
  tools: ToolGrants;

  // Entity capabilities (union)
  entity_capabilities: EntityCapabilities;

  // Interactive override (merged)
  interactive: InteractiveOverride;

  // Errors encountered during bond parsing/verification
  errors: string[];

  // Metadata
  mode: "bypass" | "bonded" | "env-var" | "default";
  label: string;
  bondCount: number;
}


// ---------------------------------------------------------------------------
// Blocked path patterns (non-negotiable floor)
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const FORGE_DIR = path.join(HOME, ".forge");

// ---------------------------------------------------------------------------
// Logging — stdout/stderr lost to TUI redraws, write to file instead
// ---------------------------------------------------------------------------

const DEBUG_LOG = path.join(HOME, ".koad-io", "harness", "bond-gate.log");

function log(msg: string): void {
  const ts = new Date().toISOString();
  try {
    fs.appendFileSync(DEBUG_LOG, `[${ts}] ${msg}\n`);
  } catch (_) {}
}

function logError(msg: string, err?: any): void {
  const detail = err ? ` — ${(err.stderr || err.message || String(err)).toString().slice(0, 300)}` : "";
  log(`ERROR ${msg}${detail}`);
}

// ---------------------------------------------------------------------------
// Constants
// Patterns never accessible regardless of bond grants.
// /trust/ was removed — bonds are cryptographically signed,
// entities can read them but can't forge them without SOVEREIGN_FINGERPRINT.
const DEFAULT_BLOCKED = ["/.env", "/.credentials", "/.git/", "/id/"];

const EMPTY_FILE_SCOPE: FileScope = {
  read: [],
  write: [],
  exec: [],
  blocked: [...DEFAULT_BLOCKED],
};

const EMPTY_TOOL_GRANTS: ToolGrants = {
  bash: false,
  dispatch: false,
  dispatch_followup: false,
  dispatch_complete: false,
  koadio_tools: [],
  koadio_commands: [],
  channels: { moderate: [], participate: [] },
};

const EMPTY_ENTITY_CAPS: EntityCapabilities = {
  dispatch_targets: [],
  message_targets: [],
  channel_roles: {},
};

const EMPTY_INTERACTIVE: InteractiveOverride = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandPath(raw: string): string {
  if (raw === "~") return HOME;
  if (raw.startsWith("~/")) return path.join(HOME, raw.slice(2));
  return path.resolve(raw);
}

function parsePathList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(":")
    .map(s => s.trim())
    .filter(Boolean)
    .map(expandPath);
}

function isUnder(absolutePath: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => {
    const resolved = path.resolve(prefix);
    const relative = path.relative(resolved, absolutePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function isBlocked(absolutePath: string, blocked: string[]): boolean {
  const normalized = absolutePath + "/";
  return blocked.some(pattern => normalized.includes(pattern));
}

// ---------------------------------------------------------------------------
// YAML frontmatter parsing
// ---------------------------------------------------------------------------

function parseYamlList(block: string, key: string): string[] {
  const keyPattern = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m");
  const match = block.match(keyPattern);
  if (!match) return [];

  const inlineValue = match[1].trim();
  if (inlineValue === "[]") return [];
  if (inlineValue.startsWith("[")) {
    return inlineValue.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
  }
  if (inlineValue) return [inlineValue];

  // Multi-line list: indented `- value` following the key
  const lines = block.split("\n");
  const keyLineIdx = lines.findIndex(l => keyPattern.test(l));
  if (keyLineIdx === -1) return [];

  const items: string[] = [];
  for (let i = keyLineIdx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    } else if (lines[i].match(/^\s+\S+:/)) {
      break;
    } else if (lines[i].trim() === "") {
      continue;
    } else {
      break;
    }
  }
  return items;
}

function parseYamlBool(block: string, key: string): boolean | undefined {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  const match = block.match(pattern);
  if (!match) return undefined;
  const val = match[1].trim().toLowerCase();
  if (val === "true" || val === "yes") return true;
  if (val === "false" || val === "no") return false;
  return undefined;
}

function parseYamlString(block: string, key: string): string | undefined {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  const match = block.match(pattern);
  if (!match) return undefined;
  return match[1].trim();
}

function parseYamlStringMap(block: string, key: string): Record<string, string> {
  const map: Record<string, string> = {};
  const keyPattern = new RegExp(`^\\s*${key}:`);
  const lines = block.split("\n");
  const startIdx = lines.findIndex(l => keyPattern.test(l));
  if (startIdx === -1) return map;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const mapMatch = line.match(/^\s+(\S[^:]*):\s*(.+)$/);
    if (mapMatch) {
      map[mapMatch[1].trim()] = mapMatch[2].trim();
    } else if (line.match(/^\s+\S+:/)) {
      // nested key at same level means we're past this map
      break;
    } else if (line.trim() === "") {
      continue;
    } else {
      break;
    }
  }
  return map;
}

function extractYamlBlock(fm: string, key: string): string | undefined {
  if (!fm.includes(`${key}:`)) return undefined;

  const start = fm.indexOf(`${key}:`);
  const after = fm.slice(start);
  const lines = after.split("\n");
  let block = lines[0] + "\n";
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].match(/^\S/) && lines[i].includes(":")) break;
    block += lines[i] + "\n";
  }
  return block;
}

// ---------------------------------------------------------------------------
// Bond parsing
// ---------------------------------------------------------------------------

function parseBonds(entity: string): { bonds: ParsedBond[]; errors: string[] } {
  const bondsDir = path.join(HOME, `.${entity}`, "trust", "bonds");
  const bonds: ParsedBond[] = [];
  const errors: string[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(bondsDir);
  } catch (_) {
    return { bonds: [], errors: [] };
  }

  const unsigned = entries.filter(e => e.endsWith(".md") && !e.endsWith(".md.asc") && !entries.includes(e + ".asc"));
  for (const u of unsigned) {
    errors.push(`unsigned bond: ${u} (needs .md.asc — bare .md files ignored)`);
  }

  for (const entry of entries) {
    // Only accept clearsigned bonds (.md.asc).
    // Bare .md files are human-readable renderings — not canonical.
    if (!entry.endsWith(".md.asc")) continue;

    const bondPath = path.join(bondsDir, entry);

    // ── Verify PGP signature ────────────────────────────
    // Each entity has GNUPGHOME set in its .env, pointing to its
    // own keyring. gpg --verify uses that keyring automatically.
    let signerFingerprint: string | undefined;

    // SOVEREIGN_PUBLIC_KEY — URL to fetch the sovereign public key
    // SOVEREIGN_FINGERPRINT — required if PUBLIC_KEY is set (pins the key)
    const sovUrl = process.env.SOVEREIGN_PUBLIC_KEY?.trim();
    const sovFp = process.env.SOVEREIGN_FINGERPRINT?.trim()?.toLowerCase();

    // Require fingerprint pinning whenever auto-import is enabled
    if (sovUrl && !sovFp) {
      log("WARN SOVEREIGN_PUBLIC_KEY set but SOVEREIGN_FINGERPRINT missing — auto-import disabled for safety");
    }

    function tryVerify(): { ok: boolean; fingerprint?: string } {
      try {
        const verifyOut = execSync(
          `gpg --no-tty --verify --status-fd=1 ${JSON.stringify(bondPath)}`,
          { env: process.env, stdio: "pipe", timeout: 5000 },
        ).toString();
        const fpMatch = verifyOut.match(/\[GNUPG:\]\s+VALIDSIG\s+(\S+)/);
        return { ok: true, fingerprint: fpMatch?.[1]?.toLowerCase() };
      } catch (err: any) {
        const stderr = (err.stderr || err.message || "").toString();
        if (stderr.includes("public key") || stderr.includes("No public key")) {
          return { ok: false };
        }
        throw new Error(stderr.slice(0, 200));
      }
    }

    let result = tryVerify();

    // Auto-import sovereign key from URL if available and fingerprint is pinned.
    // Only try once per bond — if import succeeds but verify still fails,
    // the bond was signed by a different key.
    if (!result.ok && sovUrl && sovFp) {
      // Check if key already exists in keyring
      let keyExists = false;
      try {
        execSync(`gpg --no-tty --list-keys ${sovFp}`, { env: process.env, stdio: "pipe", timeout: 5000 });
        keyExists = true;
      } catch (_) {}

      if (!keyExists) {
        log(`importing sovereign key from ${sovUrl}`);
        try {
          const gnupgHome = process.env.GNUPGHOME;
          if (gnupgHome) {
            fs.mkdirSync(gnupgHome, { recursive: true });
            fs.chmodSync(gnupgHome, 0o700);
          }
          execSync(`gpg --no-tty --list-keys`, { env: process.env, stdio: "pipe", timeout: 5000 });

          execSync(`curl -fsSL ${JSON.stringify(sovUrl)} | gpg --no-tty --import`,
            { env: process.env, stdio: "pipe", timeout: 10000 },
          );
          if (sovFp) {
            execSync(
              `echo -e "5\\ny\\n" | gpg --no-tty --batch --command-fd 0 --edit-key ${sovFp} trust`,
              { env: process.env, stdio: "pipe", timeout: 5000 },
            );
          }
          log(`sovereign key imported${sovFp ? " and trusted" : ""}`);
          result = tryVerify();
        } catch (importErr: any) {
          const msg = `sovereign key import failed: ${(importErr.stderr || importErr.message || "").toString().slice(0, 120)}`;
          logError(`sovereign key import failed`, importErr);
          errors.push(msg);
        }
      } else if (!result.ok) {
        // Key is in keyring but verification still fails — bond signed by different key
        log(`WARN sovereign key present but bond ${entry} not signed by it — bond may need re-signing`);
      }
    }

    if (!result.ok) {
      const msg = `bond sig fail: ${entry} — key not in keyring`;
      log(`WARN ${msg}`);
      errors.push(msg);
      continue;
    }
    signerFingerprint = result.fingerprint;

    // ── SOVEREIGN_FINGERPRINT must match signer ─────────
    if (sovFp && signerFingerprint !== sovFp) {
      const msg2 = `bond rejected: ${entry} signed by ${signerFingerprint?.slice(0, 16)}… (SOVEREIGN_FINGERPRINT requires ${sovFp.slice(0, 16)}…)`;
      log(`WARN ${msg2}`);
      errors.push(msg2);
      continue;
    }

    try {
      const content = fs.readFileSync(bondPath, "utf-8");
      // Strip PGP clearsign armor and fix dash-escaping.
      // Clearsign prepends "- " to lines starting with "-" (after any
      // indentation) to distinguish from PGP armor.
      const body = content
        .replace(/^-----BEGIN PGP SIGNED MESSAGE-----\s*/m, "")
        .replace(/^-----BEGIN PGP SIGNATURE-----[\s\S]*$/m, "")
        .replace(/^Hash:.*\n/m, "")
        .replace(/^(\s*)- (?=-)/gm, "$1")   // reverse clearsign: remove added "- " before original "-"
        .trim();

      const fmMatch = body.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];

      // ── Identity ──────────────────────────────────────
      const type = parseYamlString(fm, "type") ?? "unknown";
      const from = parseYamlString(fm, "from") ?? "";
      const fromFp = parseYamlString(fm, "from_fingerprint");
      const to = parseYamlString(fm, "to") ?? "";
      const status = parseYamlString(fm, "status") ?? "ACTIVE";
      const visibility = parseYamlString(fm, "visibility") ?? "private";
      const created = parseYamlString(fm, "created");
      const expires = parseYamlString(fm, "expires");
      const renewal = parseYamlString(fm, "renewal");

      // ── File scope ────────────────────────────────────
      const capBlock = extractYamlBlock(fm, "capabilities");
      const capabilities: FileScope = capBlock
        ? {
            read: parseYamlList(capBlock, "read").map(expandPath),
            write: parseYamlList(capBlock, "write").map(expandPath),
            exec: parseYamlList(capBlock, "exec").map(expandPath),
            blocked: parseYamlList(capBlock, "blocked"),
          }
        : { ...EMPTY_FILE_SCOPE };

      // ── Tool grants ───────────────────────────────────
      const toolsBlock = extractYamlBlock(fm, "tools");
      const tools: ToolGrants = toolsBlock
        ? {
            bash: parseYamlBool(toolsBlock, "bash") ?? false,
            dispatch: parseYamlBool(toolsBlock, "dispatch") ?? false,
            dispatch_followup: parseYamlBool(toolsBlock, "dispatch_followup") ?? false,
            dispatch_complete: parseYamlBool(toolsBlock, "dispatch_complete") ?? false,
            koadio_tools: parseYamlList(toolsBlock, "koadio_tools"),
            koadio_commands: parseYamlList(toolsBlock, "koadio_commands"),
            channels: {
              moderate: parseYamlList(toolsBlock, "moderate"),
              participate: parseYamlList(toolsBlock, "participate"),
            },
          }
        : { ...EMPTY_TOOL_GRANTS };

      // ── Entity capabilities ───────────────────────────
      const ecBlock = extractYamlBlock(fm, "entity_capabilities");
      const entity_capabilities: EntityCapabilities = ecBlock
        ? {
            dispatch_targets: parseYamlList(ecBlock, "dispatch_targets"),
            message_targets: parseYamlList(ecBlock, "message_targets"),
            channel_roles: parseYamlStringMap(ecBlock, "channel_roles"),
          }
        : { ...EMPTY_ENTITY_CAPS };

      // ── Interactive override ──────────────────────────
      const intBlock = extractYamlBlock(fm, "interactive");
      const interactive: InteractiveOverride = intBlock
        ? {
            bash: parseYamlBool(intBlock, "bash"),
            exec: parseYamlList(intBlock, "exec").map(expandPath),
            write: parseYamlList(intBlock, "write").map(expandPath),
          }
        : { ...EMPTY_INTERACTIVE };

      // ── Spec refs ─────────────────────────────────────
      const specRefs = parseYamlList(fm, "spec-refs");
      const reason = parseYamlString(fm, "reason");

      bonds.push({
        type, from, from_fingerprint: fromFp, to, status, visibility,
        created, expires, renewal,
        capabilities, tools, entity_capabilities, interactive,
        path: bondPath,
        specRefs, reason,
      });
    } catch (_) {
      errors.push(`bond parse error: ${entry} — unreadable or malformed frontmatter`);
    }
  }

  return { bonds, errors };
}

// ---------------------------------------------------------------------------
// Bond resolution
// ---------------------------------------------------------------------------

function isExpired(bond: ParsedBond): boolean {
  if (!bond.expires) return false;
  const expiry = new Date(bond.expires);
  return !isNaN(expiry.getTime()) && expiry < new Date();
}

function effectiveBonds(entity: string): { bonds: ParsedBond[]; errors: string[] } {
  const { bonds: all, errors } = parseBonds(entity);

  const active = all.filter(b => {
    if (b.status !== "ACTIVE") return false;
    if (isExpired(b)) return false;
    if (b.to !== entity && b.to !== "*") return false;
    return true;
  });

  return { bonds: active, errors };
}

function mergeBondScope(entity: string, bonds: ParsedBond[], errors: string[], interactive: boolean): BondScope {
  const file: FileScope = {
    read: [],
    write: [],
    exec: [],
    blocked: [...DEFAULT_BLOCKED],
  };
  const tools: ToolGrants = { ...EMPTY_TOOL_GRANTS };
  const entity_caps: EntityCapabilities = { ...EMPTY_ENTITY_CAPS };
  const intOverride: InteractiveOverride = { ...EMPTY_INTERACTIVE };

  for (const b of bonds) {
    // File scope — union
    for (const p of b.capabilities.read)
      if (!file.read.includes(p)) file.read.push(p);
    for (const p of b.capabilities.write)
      if (!file.write.includes(p)) file.write.push(p);
    for (const p of b.capabilities.exec)
      if (!file.exec.includes(p)) file.exec.push(p);
    for (const p of b.capabilities.blocked)
      if (!file.blocked.includes(p)) file.blocked.push(p);

    // Tool grants — any bond granting = true
    if (b.tools.bash) tools.bash = true;
    if (b.tools.dispatch) tools.dispatch = true;
    if (b.tools.dispatch_followup) tools.dispatch_followup = true;
    if (b.tools.dispatch_complete) tools.dispatch_complete = true;
    for (const t of b.tools.koadio_tools)
      if (!tools.koadio_tools.includes(t)) tools.koadio_tools.push(t);
    for (const c of b.tools.koadio_commands)
      if (!tools.koadio_commands.includes(c)) tools.koadio_commands.push(c);
    for (const ch of b.tools.channels.moderate)
      if (!tools.channels.moderate.includes(ch)) tools.channels.moderate.push(ch);
    for (const ch of b.tools.channels.participate)
      if (!tools.channels.participate.includes(ch)) tools.channels.participate.push(ch);

    // Entity capabilities — union
    for (const t of b.entity_capabilities.dispatch_targets)
      if (!entity_caps.dispatch_targets.includes(t)) entity_caps.dispatch_targets.push(t);
    for (const t of b.entity_capabilities.message_targets)
      if (!entity_caps.message_targets.includes(t)) entity_caps.message_targets.push(t);
    for (const [ch, role] of Object.entries(b.entity_capabilities.channel_roles)) {
      if (!entity_caps.channel_roles[ch]) entity_caps.channel_roles[ch] = role;
    }

    // Interactive override — merged
    if (b.interactive.exec) {
      for (const p of b.interactive.exec)
        if (!intOverride.exec?.includes(p)) (intOverride.exec ??= []).push(p);
    }
    if (b.interactive.write) {
      for (const p of b.interactive.write)
        if (!intOverride.write?.includes(p)) (intOverride.write ??= []).push(p);
    }
  }

  // Apply interactive override
  if (interactive) {
    if (intOverride.exec) {
      for (const p of intOverride.exec)
        if (!file.exec.includes(p)) file.exec.push(p);
    }
    if (intOverride.write) {
      for (const p of intOverride.write)
        if (!file.write.includes(p)) file.write.push(p);
    }
  }


  // ── Dispatch working directory grant ────────────────────
  // When an entity is dispatched into a specific directory, that directory
  // gets full read+write+exec access unconditionally. If you were dispatched
  // to work here, you need to be able to operate here — bond type doesn't
  // gate this; the dispatch itself is the authorization.
  const dispatchDir = process.env.HARNESS_WORK_DIR;
  if (dispatchDir) {
    const expanded = expandPath(dispatchDir);
    if (!file.read.includes(expanded)) file.read.push(expanded);
    if (!file.write.includes(expanded)) file.write.push(expanded);
    if (!file.exec.includes(expanded)) file.exec.push(expanded);
    log(`  dispatch dir: ${expanded} (r+w+e)`);
  }

  log(`  scope: r${file.read.length} w${file.write.length} e${file.exec.length} b${file.blocked.length} bash=${tools.bash} dispatch=${tools.dispatch} →${entity_caps.dispatch_targets.join(",")}`);

  return {
    file,
    tools,
    entity_capabilities: entity_caps,
    interactive: intOverride,
    errors,
    mode: "bonded",
    label: `mode=bonded bonds=${bonds.length}`,
    bondCount: bonds.length,
  };
}

function resolveGate(entity: string, interactive: boolean): BondScope {
  // Bypass
  const bypass = process.env.KOAD_IO_BOND_GATE_BYPASS === "1"
    || process.env.KOAD_IO_PI_BOND_GATE_BYPASS === "1";
  if (bypass) {
    return {
      file: { read: ["/"], write: ["/"], exec: ["/"], blocked: [] },
      tools: { bash: true, dispatch: true, dispatch_followup: true, dispatch_complete: true, channels: { moderate: ["*"], participate: ["*"] } },
      entity_capabilities: { dispatch_targets: ["*"], message_targets: ["*"], channel_roles: {} },
      interactive: {},
      errors: [],
      mode: "bypass",
      label: "mode=bypass — ALL ACCESS GRANTED",
      bondCount: 0,
    };
  }

  // Bonds from disk
  const { bonds, errors } = effectiveBonds(entity);
  log(`gate ${interactive ? "UI" : "headless"}: ${bonds.length} bonds, ${errors.length} errors`);
  if (bonds.length > 0) {
    return mergeBondScope(entity, bonds, errors, interactive);
  }

  // Workspace fallback — if the entity was dispatched into a folder, it gets
  // full read/write/exec access to that folder even when no valid bonds are
  // present. The dispatch itself is the authorization — you can't work in a
  // directory you can't read, write, or shell into.
  const dispatchDir = process.env.HARNESS_WORK_DIR?.trim();
  if (dispatchDir) {
    const expanded = expandPath(dispatchDir);
    return {
      file: { read: [expanded], write: [expanded], exec: [expanded], blocked: [...DEFAULT_BLOCKED] },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors,
      mode: "env-var",
      label: "mode=env-var dispatch dir r+w+e",
      bondCount: 0,
    };
  }

  // No valid bonds — but report parse/verification errors
  if (errors.length > 0) {
    return {
      file: { ...EMPTY_FILE_SCOPE },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors,
      mode: "default",
      label: "mode=default — no valid bonds",
      bondCount: 0,
    };
  }

  // Env-var fallback
  // Env-var fallback
  const envScope = parsePathList(process.env.KOAD_IO_HARNESS_READ_PATHS);
  const envWrite = parsePathList(process.env.KOAD_IO_HARNESS_WRITE_PATHS);
  const envExec = parsePathList(process.env.KOAD_IO_HARNESS_EXEC_PATHS);
  if (envScope.length > 0 || envWrite.length > 0 || envExec.length > 0) {
    return {
      file: { read: envScope, write: envWrite, exec: envExec, blocked: [...DEFAULT_BLOCKED] },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors: [],
      mode: "env-var",
      label: "mode=env-var custom",
      bondCount: 0,
    };
  }

  // Default — no bonds, no access
  return {
    file: { ...EMPTY_FILE_SCOPE },
    tools: { ...EMPTY_TOOL_GRANTS },
    entity_capabilities: { ...EMPTY_ENTITY_CAPS },
    interactive: {},
    errors: [],
    mode: "default",
    label: "mode=default — no bonds, no access",
    bondCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Audit
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
    const readDirs = scope.file.read.map(d => d.replace(HOME, "~")).join(", ");
    const writeDirs = scope.file.write.map(d => d.replace(HOME, "~")).join(", ");
    const execDirs = scope.file.exec.map(d => d.replace(HOME, "~")).join(", ");
    lines.push(`  file scope:`);
    lines.push(`    read:  ${readDirs || "(none)"}`);
    lines.push(`    write: ${writeDirs || "(none)"}`);
    lines.push(`    exec:  ${execDirs || "(none)"}`);
    lines.push(`  tool grants: bash=${scope.tools.bash} dispatch=${scope.tools.dispatch}`);
  }
  lines.push(`  action: use koad-io tool or ask_question(to="koad") to request expanded permissions`);
  return lines.join("\n");
}

function auditBlock(entity: string, toolName: string, pathArg: string, reason: string): void {
  const _ip = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
  const controlUrl = process.env.KOAD_IO_CONTROL_URL ?? `http://${_ip}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;
  const emitEnabled = process.env.KOAD_IO_EMIT === "1";
  if (!emitEnabled) return;
  fetch(`${controlUrl}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity,
      type: "tool.blocked",
      body: `${entity}: ${toolName} ${pathArg} blocked — ${reason}`,
      timestamp: new Date().toISOString(),
      meta: { payload: { tool: toolName, path: pathArg, reason, bondGate: true } },
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}

function logMode(ctx: any, message: string, level: "info" | "warning" = "info"): void {
  log(level === "warning" ? `WARN ${message}` : message);
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

const KOADIO_TOOLS = new Set([
  "ask_question", "wait_for_answer", "answer_question",
  "wait_for_cue", "raise_hand", "channel_leave",
  "channel_state_read", "channel_cue_deliver", "channel_broadcast",
  "channel_wait_for_next_turn", "channel_wait_for_state_change",
  "channel_event_fire",
  "search", "status", "music", "koad-io", "wait",
  "mission",
]);

// Tools gated by bond tool grants — require explicit permission
const GATED_DISPATCH_TOOLS = new Set(["dispatch", "dispatch_followup", "dispatch_complete"]);

const FILE_READ_TOOLS = new Set(["read", "find", "grep", "ls"]);
const FILE_WRITE_TOOLS = new Set(["write", "edit"]);
const SHELL_TOOLS = new Set(["bash"]);

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export function registerBondGate(pi: ExtensionAPI) {
  const entity = process.env.ENTITY ?? "";
  if (!entity) {
    log("ENTITY unset — gate disabled");
    return;
  }

  let scope = resolveGate(entity, false);

  // -----------------------------------------------------------------------
  // session_start
  // -----------------------------------------------------------------------

  pi.on("session_start", (_event, ctx) => {
    scope = resolveGate(entity, ctx.hasUI);
    logMode(ctx, scope.label, scope.mode === "bypass" ? "warning" : "info");

    // Surface bond errors in the footer status area
    if (scope.errors.length > 0) {
      ctx.ui.setStatus("bond-gate", `⚠ bonds: ${scope.errors[0]}${scope.errors.length > 1 ? ` (+${scope.errors.length - 1} more)` : ""}`);
      for (const err of scope.errors) {
        ctx.ui.notify(`[bond-gate] ${err}`, "warning");
      }
    } else if (scope.mode !== "bypass") {
      ctx.ui.setStatus("bond-gate", `${scope.bondCount} bond${scope.bondCount !== 1 ? "s" : ""} active`);
    }
  });

  // -----------------------------------------------------------------------
  // tool_call
  // -----------------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const { toolName, input } = event;

    // Re-resolve on every call — live reloadable
    scope = resolveGate(entity, ctx.hasUI);
    const mode = scope.mode;

    if (mode === "bypass") return undefined;

    // ── koad:io ecosystem tools — bond-gated ──────────────────
    if (KOADIO_TOOLS.has(toolName)) {
      if (!scope.tools.koadio_tools.includes(toolName) && !scope.tools.koadio_tools.includes("*")) {
        log(`BLOCK koadio tool ${toolName}: not in koadio_tools grant (mode=${mode})`);
        auditBlock(entity, toolName, "", "koadio tool not granted by bond");
        return { block: true, reason: bondBlockReason(entity, toolName, `${toolName} not granted — add to koadio_tools in bond`, scope) };
      }
      // koad-io cascade tool — gate each command individually
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

    // Resolve path argument
    const rawPath =
      (input as Record<string, unknown>)?.path as string | undefined
      ?? (input as Record<string, unknown>)?.directory as string | undefined;

    const effectiveCwd = process.env.HARNESS_WORK_DIR || ctx.cwd;

    let absolutePath: string | undefined;
    if (rawPath) {
      absolutePath = path.resolve(effectiveCwd, rawPath);
    }

    // ── Read tools — cwd + children readable if cwd in scope ─
    if (FILE_READ_TOOLS.has(toolName)) {
      // cwd is readable only when it's within read scope
      if (absolutePath && scope.file.read.length > 0 && isUnder(effectiveCwd, scope.file.read) && isUnder(absolutePath, [effectiveCwd])) {
        if (isBlocked(absolutePath, scope.file.blocked)) {
          auditBlock(entity, toolName, rawPath!, "blacklisted path");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is a protected path`) };
        }
        return undefined;
      }
      if (scope.file.read.length === 0) {
        log(`BLOCK read: no scope (mode=${mode})`);
        auditBlock(entity, toolName, rawPath ?? "", "no read permissions");
        return { block: true, reason: bondBlockReason(entity, toolName, "no bond grants read permissions — use koad-io tool or ask_question(to=\"koad\") to request access", scope) };
      }
      if (absolutePath) {
        if (isBlocked(absolutePath, scope.file.blocked)) {
          auditBlock(entity, toolName, rawPath!, "blacklisted path");
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is a protected path`) };
        }
        if (!isUnder(absolutePath, scope.file.read)) {
          return { block: true, reason: bondBlockReason(entity, toolName, `${rawPath} is outside bond scope`, scope) };
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
      if (!isUnder(ctx.cwd, scope.file.exec)) {
        auditBlock(entity, "bash", ctx.cwd, "cwd outside exec scope");
        return { block: true, reason: bondBlockReason(entity, "bash", `working directory outside bond exec scope`, scope) };
      }
      return undefined;
    }

    // Default deny
    log(`BLOCK ${toolName}: unrecognized (mode=${mode})`);
    auditBlock(entity, toolName, "", "unrecognized tool");
    return { block: true, reason: bondBlockReason(entity, toolName, "unrecognized tool — use koad-io tool or ask_question(to=\"koad\") to request capability expansion", scope) };
  });

  // -----------------------------------------------------------------------
  // before_agent_start: inject bond scope into system prompt
  // -----------------------------------------------------------------------

  pi.on("before_agent_start", (_event, ctx) => {
    scope = resolveGate(entity, ctx.hasUI);
    // One-liner: bonds=N r# w# e# bash|dispatch targets
    const parts = [
      `${scope.bondCount}b`,
      `r${scope.file.read.length} w${scope.file.write.length} e${scope.file.exec.length}`,
    ];
    if (scope.tools.bash) parts.push("bash");
    if (scope.tools.dispatch) parts.push(`→${scope.entity_capabilities.dispatch_targets.length}`);
    const label = scope.mode === "bonded"
      ? `bonded:${parts.join(" ")}`
      : scope.mode === "bypass" ? "bypass" : "none";
    ctx.ui.setWorkingMessage(`${entity} · ${label}`);
  });

  // Expose scope so other extensions can inspect it
  (pi as any).__bondScope = scope;
}
