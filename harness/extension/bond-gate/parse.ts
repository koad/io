// koad:io bond-gate — bond file parsing, YAML frontmatter, GPG verification.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ParsedBond } from "./types";
import {
  HOME,
  EMPTY_FILE_SCOPE, EMPTY_TOOL_GRANTS, EMPTY_ENTITY_CAPS, EMPTY_INTERACTIVE,
  expandPath,
  log,
  normalizeFingerprint,
} from "./types";

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
// Clearsigned body extraction
// ---------------------------------------------------------------------------

export function extractClearsignedBody(content: string): string {
  return content
    .replace(/^-----BEGIN PGP SIGNED MESSAGE-----\s*/m, "")
    .replace(/^-----BEGIN PGP SIGNATURE-----[\s\S]*$/m, "")
    .replace(/^Hash:.*\n/m, "")
    .replace(/^(\s*)- (?=-)/gm, "$1")
    .trim();
}

function extractFrontmatter(body: string): string | undefined {
  return body.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export interface BondSignatureResult {
  valid: boolean;
  signer?: string;
  keyId?: string;
  fingerprint?: string;
  expectedFingerprint?: string;
  reason?: string;
}

function readFingerprintFile(filePath: string): string | undefined {
  try {
    return normalizeFingerprint(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return undefined;
  }
}

function expectedFingerprintForIssuer(from: string, fromFingerprint?: string): string | undefined {
  const explicit = normalizeFingerprint(fromFingerprint);
  if (explicit) return explicit;

  const entityPaths = [
    path.join(HOME, `.${from}`, "id", "entity.fingerprint"),
    path.join(HOME, `.${from}`, "id", "master.fingerprint"),
  ];

  for (const candidate of entityPaths) {
    const fingerprint = readFingerprintFile(candidate);
    if (fingerprint) return fingerprint;
  }

  return undefined;
}

function describeVerifyFailure(output: string, status: number | null): string {
  if (/NO_PUBKEY/.test(output)) return "public key not in keyring";
  if (/BADSIG/.test(output)) return "bad signature";
  if (/ERRSIG/.test(output)) return "signature verification failed";
  if (/NODATA/.test(output)) return "not a signed bond file";
  if (status === 124) return "verification timed out";
  return `gpg verify exited ${status ?? "unknown"}`;
}

export function verifyBondSignature(filePath: string, declaredFrom: string, fromFingerprint?: string): BondSignatureResult {
  const verify = spawnSync(
    "gpg",
    ["--no-tty", "--status-fd=1", "--verify", filePath],
    { env: process.env, encoding: "utf8", timeout: 5000 },
  );

  const output = `${verify.stdout ?? ""}\n${verify.stderr ?? ""}`;
  const fingerprint = normalizeFingerprint(output.match(/\[GNUPG:\]\s+VALIDSIG\s+(\S+)/)?.[1]);
  const goodSig = output.match(/\[GNUPG:\]\s+GOODSIG\s+(\S+)\s+(.+)/);
  const keyId = normalizeFingerprint(goodSig?.[1]) ?? fingerprint?.slice(-16);
  const signer = goodSig?.[2]?.trim() || declaredFrom;
  const expectedFingerprint = expectedFingerprintForIssuer(declaredFrom, fromFingerprint);

  if (verify.status !== 0 || !fingerprint) {
    return {
      valid: false,
      signer,
      keyId,
      fingerprint,
      expectedFingerprint,
      reason: describeVerifyFailure(output, verify.status),
    };
  }

  if (expectedFingerprint && fingerprint !== expectedFingerprint) {
    return {
      valid: false,
      signer,
      keyId,
      fingerprint,
      expectedFingerprint,
      reason: `signed by ${fingerprint.slice(0, 16)}… but ${declaredFrom} expects ${expectedFingerprint.slice(0, 16)}…`,
    };
  }

  return {
    valid: true,
    signer,
    keyId,
    fingerprint,
    expectedFingerprint,
  };
}

// ---------------------------------------------------------------------------
// Bond parsing
// ---------------------------------------------------------------------------

export function parseBonds(entity: string): { bonds: ParsedBond[]; errors: string[] } {
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
    if (!entry.endsWith(".md.asc")) continue;

    const bondPath = path.join(bondsDir, entry);

    try {
      const content = fs.readFileSync(bondPath, "utf-8");
      const body = extractClearsignedBody(content);
      const fm = extractFrontmatter(body);
      if (!fm) {
        errors.push(`bond parse error: ${entry} — unreadable or malformed frontmatter`);
        continue;
      }

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
      const device_ids = parseYamlList(fm, "device_ids");

      const verification = verifyBondSignature(bondPath, from, fromFp);
      if (!verification.valid) {
        const msg = `bond rejected: ${entry} — ${verification.reason ?? "invalid signature"}`;
        log(`WARN ${msg}`);
        errors.push(msg);
        continue;
      }

      // ── File scope ────────────────────────────────────
      const capBlock = extractYamlBlock(fm, "capabilities");
      const capabilities = capBlock
        ? {
            read: parseYamlList(capBlock, "read").map(expandPath),
            write: parseYamlList(capBlock, "write").map(expandPath),
            exec: parseYamlList(capBlock, "exec").map(expandPath),
            blocked: parseYamlList(capBlock, "blocked"),
          }
        : { ...EMPTY_FILE_SCOPE };

      // ── Tool grants ───────────────────────────────────
      const toolsBlock = extractYamlBlock(fm, "tools");
      const tools = toolsBlock
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
      const entity_capabilities = ecBlock
        ? {
            dispatch_targets: parseYamlList(ecBlock, "dispatch_targets"),
            message_targets: parseYamlList(ecBlock, "message_targets"),
            channel_roles: parseYamlStringMap(ecBlock, "channel_roles"),
          }
        : { ...EMPTY_ENTITY_CAPS };

      // ── Interactive override ──────────────────────────
      const intBlock = extractYamlBlock(fm, "interactive");
      const interactive = intBlock
        ? {
            bash: parseYamlBool(intBlock, "bash"),
            exec: parseYamlList(intBlock, "exec").map(expandPath),
            write: parseYamlList(intBlock, "write").map(expandPath),
          }
        : { ...EMPTY_INTERACTIVE };

      const specRefs = parseYamlList(fm, "spec-refs");
      const reason = parseYamlString(fm, "reason");

      bonds.push({
        type, from, from_fingerprint: fromFp, to, status, visibility,
        created, expires, renewal,
        capabilities, tools, entity_capabilities, interactive,
        device_ids,
        path: bondPath,
        specRefs, reason,
      });
    } catch (_) {
      errors.push(`bond parse error: ${entry} — unreadable or malformed frontmatter`);
    }
  }

  return { bonds, errors };
}
