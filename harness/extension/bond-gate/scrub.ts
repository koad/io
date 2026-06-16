/**
 * koad:io bond-gate — secret scrubbing for tool results.
 *
 * Redacts private keys, tokens, passwords, protected paths, and
 * other sensitive material from tool results before they reach
 * visitors or are stored in shared session logs.
 *
 * Ported from ~/.forge/packages/harness/tools/pi-sdk-bond-gate.js
 * so the TypeScript extension is the single source of truth.
 */

import * as path from "node:path";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PROTECTED_PATH_RE =
  /(?:^|[\s"'])((?:~\/|\/)[^\s"']*(?:\.env|\.credentials|auth\.json|\/id\/|\/secrets?\/|\/private\/)[^\s"']*)/i;

const KEY_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|PGP PRIVATE KEY BLOCK|OPENSSH PRIVATE KEY)-----/g;

const ENV_ASSIGNMENT_RE =
  /(^|\n)([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|COOKIE|SESSION|AUTH|CREDENTIAL)[A-Z0-9_]*)=([^\n]*)/g;

const JSON_SECRET_RE =
  /("(?:apiKey|token|secret|password|passphrase|privateKey|authorization|cookie|session|credential)[^"]*"\s*:\s*")([^"]*)(")/gi;

// ---------------------------------------------------------------------------
// Path checking
// ---------------------------------------------------------------------------

export function isProtectedPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return PROTECTED_PATH_RE.test(value);
}

export function inputLooksSensitive(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const obj = input as Record<string, unknown>;
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && isProtectedPath(value)) return true;
    if (Array.isArray(value) && value.some((item) => typeof item === "string" && isProtectedPath(item))) return true;
  }
  const command = obj.command ?? obj.body ?? obj.args;
  return typeof command === "string" &&
    /(?:^|\s)(?:env|printenv)\b|(?:cat|sed|awk|grep)\s+[^\n]*(?:\.env|\.credentials|auth\.json)|BEGIN [A-Z ]*PRIVATE KEY/i.test(command);
}

// ---------------------------------------------------------------------------
// Text scrubbing
// ---------------------------------------------------------------------------

export interface ScrubResult {
  text: string;
  changed: boolean;
}

export function scrubText(text: string): ScrubResult {
  let next = String(text ?? "");
  let changed = false;

  const replace = (regex: RegExp, replacer: string | ((m: string, ...args: string[]) => string)): void => {
    const before = next;
    next = next.replace(regex, replacer as any);
    if (next !== before) changed = true;
  };

  replace(KEY_BLOCK_RE, "[redacted private key material]");
  replace(ENV_ASSIGNMENT_RE, (_m, prefix: string, name: string) => `${prefix}${name}=[redacted]`);
  replace(JSON_SECRET_RE, (_m, prefix: string, _value: string, suffix: string) => `${prefix}[redacted]${suffix}`);
  replace(PROTECTED_PATH_RE, (_m, protectedPath: string) => `[redacted protected path: ${path.basename(protectedPath)}]`);

  return { text: next, changed };
}

// ---------------------------------------------------------------------------
// Deep scrubbing
// ---------------------------------------------------------------------------

export function scrubUnknown(value: unknown): { result: unknown; changed: boolean } {
  if (typeof value === "string") {
    const { text, changed } = scrubText(value);
    return { result: changed ? text : value, changed };
  }
  if (Array.isArray(value)) {
    let anyChanged = false;
    const scrubbed = value.map((item) => {
      const s = scrubUnknown(item);
      if (s.changed) anyChanged = true;
      return s.result;
    });
    return { result: anyChanged ? scrubbed : value, changed: anyChanged };
  }
  if (value && typeof value === "object") {
    let anyChanged = false;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const s = scrubUnknown(item);
      output[key] = s.result;
      if (s.changed) anyChanged = true;
    }
    return { result: anyChanged ? output : value, changed: anyChanged };
  }
  return { result: value, changed: false };
}

// ---------------------------------------------------------------------------
// Tool result scrubbing (for pi extension tool_result handler)
// ---------------------------------------------------------------------------

export interface ScrubbedToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

export function scrubToolResult(
  content: Array<{ type: string; text?: string; [key: string]: unknown }>,
  details: Record<string, unknown>,
  isError?: boolean,
): ScrubbedToolResult | undefined {
  let contentChanged = false;
  const scrubbedContent = (content ?? []).map((part) => {
    if (!part || part.type !== "text" || typeof part.text !== "string") return part;
    const { text, changed } = scrubText(part.text);
    if (changed) contentChanged = true;
    return { ...part, text };
  });

  const { result: scrubbedDetails, changed: detailsChanged } = scrubUnknown(details);

  if (!contentChanged && !detailsChanged) return undefined;

  return {
    content: scrubbedContent,
    details: scrubbedDetails as Record<string, unknown>,
    isError,
  };
}
