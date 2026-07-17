import fs from "node:fs";
import path from "node:path";

export function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "0";
  return Number(value).toLocaleString("en-US");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[index]}`;
}

export function formatMoney(value) {
  if (!Number.isFinite(Number(value))) return "$0.000000";
  return `$${Number(value).toFixed(6)}`;
}

export function formatDurationSeconds(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "0s";
  let remaining = Math.round(Number(seconds));
  const days = Math.floor(remaining / 86400);
  remaining -= days * 86400;
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  remaining -= minutes * 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || parts.length === 0) parts.push(`${remaining}s`);
  return parts.join(" ");
}

export function clip(text, limit = 200) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

export function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function parseJsonlLine(line) {
  if (!line || !line.trim()) return { ok: false, empty: true };
  const parsed = safeJsonParse(line);
  if (parsed.ok) return { ok: true, value: parsed.value };
  return { ok: false, error: parsed.error };
}

export function parseSimpleFrontmatter(text) {
  const raw = String(text ?? "");
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { hasFrontmatter: false, attributes: {}, body: raw, rawFrontmatter: "" };
  }
  const normalized = raw.replace(/\r\n/g, "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { hasFrontmatter: false, attributes: {}, body: raw, rawFrontmatter: "" };
  }
  const frontmatterBlock = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const attributes = {};
  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attributes[key] = value;
  }
  return { hasFrontmatter: true, attributes, body, rawFrontmatter: frontmatterBlock };
}

export function looksBinaryBuffer(buffer) {
  if (!buffer || buffer.length === 0) return false;
  let suspicious = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.2;
}

export function readHeadBuffer(filePath, bytes = 4096) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function sampleTextLines(filePath, { maxLines = 5, maxBytes = 8192 } = {}) {
  const buffer = readHeadBuffer(filePath, maxBytes);
  if (looksBinaryBuffer(buffer)) return [];
  return buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, maxLines);
}

export function collectTopLevelShape(value, { maxKeys = 12 } = {}) {
  if (Array.isArray(value)) {
    const sample = value.slice(0, 5).map((entry) => describeValue(entry));
    return { kind: "array", length: value.length, sample };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, maxKeys).map(([key, entry]) => ({ key, type: describeValue(entry) }));
    return { kind: "object", keys: Object.keys(value).length, sample: entries };
  }
  return { kind: typeof value, sample: describeValue(value) };
}

export function describeValue(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  return typeof value;
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    return value;
  }
  return undefined;
}

export function normalizeIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function elapsedSeconds(startedAt, endedAt = Date.now()) {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = endedAt ? new Date(endedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

export function fileTypeFromStat(stat) {
  if (!stat) return "missing";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

export function basenameOrInput(target) {
  return path.basename(target || "") || String(target || "<unknown>");
}
