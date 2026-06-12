// koad:io bond-gate — bash denylist loaders.

import * as fs from "node:fs";
import * as path from "node:path";
import { HOME, parseNameList } from "./types";

const cache = new Map<string, { mtimeMs: number; lines: string[] }>();

function linesFromEnv(...names: string[]): string[] {
  const values: string[] = [];
  for (const name of names) {
    for (const value of parseNameList(process.env[name])) {
      if (!values.includes(value)) values.push(value);
    }
  }
  return values;
}

function denyPatternFileFor(entity: string): string {
  const fromEnv = process.env.KOAD_IO_BASH_DENY_PATTERNS_FILE?.trim()
    || process.env.KOAD_IO_PI_BASH_DENY_PATTERNS_FILE?.trim();
  if (fromEnv) return fromEnv;
  return path.join(HOME, `.${entity}`, "harness", "bash-deny-patterns.txt");
}

function loadLineFile(file: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.lines;

  try {
    const lines = fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"));
    cache.set(file, { mtimeMs: stat.mtimeMs, lines });
    return lines;
  } catch {
    return [];
  }
}

export function loadDenyCommands(): string[] {
  return linesFromEnv("KOAD_IO_BASH_DENY_COMMANDS", "KOAD_IO_PI_BASH_DENY_COMMANDS").map(v => v.toLowerCase());
}

export function loadDenyPatterns(entity: string): string[] {
  const merged: string[] = [];
  for (const value of linesFromEnv("KOAD_IO_BASH_DENY_PATTERNS", "KOAD_IO_PI_BASH_DENY_PATTERNS")) {
    if (!merged.includes(value)) merged.push(value);
  }
  if (!entity) return merged;
  for (const value of loadLineFile(denyPatternFileFor(entity))) {
    if (!merged.includes(value)) merged.push(value);
  }
  return merged;
}
