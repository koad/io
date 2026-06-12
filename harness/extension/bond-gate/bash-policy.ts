// koad:io bond-gate — bash command sanitation + routing hints.

import { isUnder, resolveToolPath } from "./types";
import { lookupRouting } from "./bash-routing";
import { loadDenyCommands, loadDenyPatterns } from "./bash-denylist";

export interface BashPolicyBlock {
  detail: string;
  auditReason: string;
  commandSnippet: string;
}

function clip(text: string, max = 160): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function splitSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\n)+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function firstWord(segment: string): string | undefined {
  const cleaned = segment.replace(/^env\s+/, "");
  const match = cleaned.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:command\s+)?([A-Za-z0-9._-]+)/);
  return match?.[1];
}

function parseCdTarget(segment: string): string | undefined {
  const match = segment.match(/^cd\s+(.+?)(?:\s*(?:&&|\|\||;).*)?$/);
  if (!match) return undefined;
  let target = match[1].trim();
  if (!target || target.startsWith("$") || target.includes("$(") || target.includes("`") || target === "-") return undefined;
  target = target.replace(/^['"]|['"]$/g, "");
  return target || undefined;
}

function block(detail: string, auditReason: string, command: string): BashPolicyBlock {
  return {
    detail,
    auditReason,
    commandSnippet: clip(command),
  };
}

export function inspectBashCommand(command: unknown, effectiveCwd: string, execScope: string[], entity = process.env.ENTITY ?? ""): BashPolicyBlock | undefined {
  // Bypass: skip policy inspection when the bond gate is in full bypass or bash is explicitly allowed.
  if (
    process.env.KOAD_IO_BOND_GATE_BYPASS === "1" ||
    process.env.KOAD_IO_PI_BOND_GATE_BYPASS === "1" ||
    process.env.KOAD_IO_BOND_GATE_ALLOW_BASH === "1" ||
    process.env.KOAD_IO_PI_BOND_GATE_ALLOW_BASH === "1"
  ) {
    return undefined;
  }

  if (typeof command !== "string") {
    return block(
      "bash command missing or malformed — provide a plain string command",
      "malformed bash input",
      String(command ?? ""),
    );
  }

  const raw = command.trim();
  if (!raw) return block("bash command is empty", "empty bash command", raw);
  if (raw.includes("\u0000")) {
    return block(
      "bash command contains NUL bytes — submit a normal shell command string",
      "bash command contains NUL",
      raw,
    );
  }

  const segments = splitSegments(raw);
  const primaryWord = firstWord(segments[0])?.toLowerCase();

  const routed = lookupRouting(entity, primaryWord, raw);
  if (routed) {
    return block(routed.detail, routed.auditReason, raw);
  }

  const envDenyCommands = loadDenyCommands();
  if (primaryWord && envDenyCommands.includes(primaryWord)) {
    return block(
      `bash command "${primaryWord}" blocked by KOAD_IO_BASH_DENY_COMMANDS — use a kingdom tool, routing table, or another lane`,
      `env bash deny command: ${primaryWord}`,
      raw,
    );
  }

  const envDenyPatterns = loadDenyPatterns(entity);
  for (const pattern of envDenyPatterns) {
    try {
      const re = new RegExp(pattern, "i");
      if (re.test(raw)) {
        return block(
          `bash command matched deny-pattern policy (${pattern}) — use a kingdom tool, routing table, or another lane`,
          `bash deny pattern: ${pattern}`,
          raw,
        );
      }
    } catch {
      if (raw.toLowerCase().includes(pattern.toLowerCase())) {
        return block(
          `bash command matched deny-pattern policy (${pattern}) — use a kingdom tool, routing table, or another lane`,
          `bash deny pattern: ${pattern}`,
          raw,
        );
      }
    }
  }

  if (/\b(sudo|su|doas)\b/.test(raw)) {
    return block(
      'privilege escalation via bash is blocked — ask_question(to="koad") or pass machine-admin work to Rooty',
      "privilege escalation command",
      raw,
    );
  }

  if (/\b(systemctl|service|launchctl|shutdown|reboot|poweroff|halt|mount|umount|fdisk|mkfs|dd|killall|pkill)\b/.test(raw)) {
    return block(
      "host-level process or device control via bash is blocked — pass infrastructure or healing work to Rooty or Salus",
      "host-level shell command",
      raw,
    );
  }

  if (/\brm\s+-rf\s+(\/|~(?:\/|$))/i.test(raw)) {
    return block(
      "destructive recursive deletion outside the work lane is blocked — use write/edit for scoped file changes or pass repair work to Salus",
      "destructive rm -rf",
      raw,
    );
  }

  // daemon/control curl — blocked by default, bypass with KOAD_IO_BOND_GATE_ALLOW_CURL=1
  // Even when bypassed, the guidance message still fires so the entity knows about the dedicated tools.
  if (/\b(curl|wget)\b/.test(raw) && /(10\.10\.10\.10:2828[23]|\/api\/(health|questions|missions|emissions|sessions|bonds|entities|channels))/i.test(raw)) {
    if (process.env.KOAD_IO_BOND_GATE_ALLOW_CURL === "1") {
      return undefined; // allowed — guidance suppressed, entity knows what it's doing
    }
    return block(
      "daemon/control HTTP calls via bash are blocked — use status, mission_query, session_query, emission_query, question_query, bond_query, entity_query, or channel tools instead. Set KOAD_IO_BOND_GATE_ALLOW_CURL=1 to bypass.",
      "daemon/control HTTP bypass attempt",
      raw,
    );
  }

  for (const segment of segments) {
    const word = firstWord(segment)?.toLowerCase();
    if (!word) continue;

    if (word === "git") {
      return block(
        'git via bash is blocked — use the koad-io tool with command="git" (or pass build/refactor work to Vulcan)',
        "git through bash",
        raw,
      );
    }

    if (word === "koad-io") {
      const subCommand = segment.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/g, "").replace(/^(?:command\s+)?koad-io\s+/, "").split(/\s+/)[0]?.toLowerCase();
      const lifecycleCommands = ["stop", "start", "restart"];
      if (!subCommand || !lifecycleCommands.includes(subCommand)) {
        return block(
          'koad-io via bash is blocked — use the typed koad-io tool directly (lifecycle commands stop/start/restart are allowed)',
          "koad-io through bash",
          raw,
        );
      }
    }

    if (["dispatch", "juno", "vulcan", "muse", "sibyl", "vesta", "salus", "rooty", "argus", "mercury", "iris", "faber", "copia", "alice", "chiron", "cacula", "lyra", "rufus", "livy", "aegis", "janus", "veritas"].includes(word)) {
      return block(
        "entity launchers via bash are blocked — use the dispatch tool for flights or the typed koad-io tool for kingdom commands",
        "entity launcher through bash",
        raw,
      );
    }

    if (["grep", "rg", "find", "fd", "ls"].includes(word)) {
      return block(
        "filesystem discovery via bash is blocked — use read, ls, sin, or search instead",
        "filesystem discovery through bash",
        raw,
      );
    }

    if (["cat", "head", "tail"].includes(word)) {
      return block(
        "file reading via bash is blocked — use read instead",
        "file read through bash",
        raw,
      );
    }

    const cdTarget = parseCdTarget(segment);
    if (cdTarget) {
      const absoluteTarget = resolveToolPath(cdTarget, effectiveCwd);
      if (!isUnder(absoluteTarget, execScope)) {
        return block(
          `cd to ${cdTarget} is outside the granted exec lane — widen KOAD_IO_HARNESS_EXEC_PATHS or use a different tool lane`,
          "cd outside exec scope",
          raw,
        );
      }
    }

    if ((word === "python" || word === "python3" || word === "node" || word === "perl") && /\/(\.env|\.credentials|id\/|trust\/|\.git\/)/.test(segment)) {
      return block(
        "direct secret or trust-path access via interpreter shell one-liners is blocked — use bonded file tools or ask_question(to=\"koad\") for expansion",
        "interpreter access to protected path",
        raw,
      );
    }
  }

  return undefined;
}
