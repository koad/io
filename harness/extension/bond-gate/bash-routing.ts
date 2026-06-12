// koad:io bond-gate — optional per-entity bash routing table.

import * as fs from "node:fs";
import * as path from "node:path";
import { HOME } from "./types";

export interface RoutingHit {
  detail: string;
  auditReason: string;
}

type CommandEntry = string | { detail: string; auditReason?: string };
interface PatternEntry {
  regex: string;
  detail: string;
  auditReason?: string;
}
interface RoutingConfig {
  commands?: Record<string, CommandEntry>;
  patterns?: PatternEntry[];
}

const cache = new Map<string, { mtimeMs: number; config: RoutingConfig }>();

function routingFileFor(entity: string): string {
  const fromEnv = process.env.KOAD_IO_BASH_ROUTING_FILE?.trim()
    || process.env.KOAD_IO_PI_BASH_ROUTING_FILE?.trim();
  if (fromEnv) return fromEnv;
  return path.join(HOME, `.${entity}`, "harness", "bash-routing.json");
}

function loadConfig(entity: string): RoutingConfig {
  const file = routingFileFor(entity);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return {};
  }

  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.config;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RoutingConfig;
    const config: RoutingConfig = {
      commands: parsed.commands && typeof parsed.commands === "object" ? parsed.commands : {},
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns.filter(p => p && typeof p.regex === "string" && typeof p.detail === "string") : [],
    };
    cache.set(file, { mtimeMs: stat.mtimeMs, config });
    return config;
  } catch {
    return {};
  }
}

function normalizeCommandEntry(command: string, entry: CommandEntry): RoutingHit {
  if (typeof entry === "string") {
    return { detail: entry, auditReason: `entity routing for ${command}` };
  }
  return {
    detail: entry.detail,
    auditReason: entry.auditReason || `entity routing for ${command}`,
  };
}

export function lookupRouting(entity: string, commandWord: string | undefined, rawCommand: string): RoutingHit | undefined {
  if (!entity) return undefined;
  const config = loadConfig(entity);
  const commandKey = commandWord?.toLowerCase();

  if (commandKey && config.commands) {
    const entry = config.commands[commandKey];
    if (entry) return normalizeCommandEntry(commandKey, entry);
  }

  for (const pattern of config.patterns ?? []) {
    try {
      const re = new RegExp(pattern.regex, "i");
      if (re.test(rawCommand)) {
        return {
          detail: pattern.detail,
          auditReason: pattern.auditReason || `entity routing for /${pattern.regex}/`,
        };
      }
    } catch {
      continue;
    }
  }

  return undefined;
}
