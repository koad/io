/**
 * meteor_shell — run arbitrary JS expressions against a Meteor server's DDP connection.
 *
 * Calls the eval.server DDP method on either control-tower or daemon.
 * The target server must have eval.server registered (control-tower: src/server/eval.js).
 *
 * Features:
 *   - Multi-statement: splits code on `;` and newlines, evals sequentially.
 *     `let`/`const`/`var` declarations are hoisted so subsequent statements
 *     can reference them. Returns the last statement's result.
 *   - Auto-format: objects and arrays are JSON.stringify'd with 2-space indent.
 *     Strings and primitives are returned as-is.
 *   - target: 'all' — fans the same code to control + daemon + live in parallel,
 *     returning results keyed by target name.
 *
 * Used by: juno (and other entities) to introspect live Meteor servers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getDDPClient } from "../ddp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split code into statements, preserving string literals and template strings.
 * Hoists `let`/`const`/`var` declarations so subsequent statements can reference
 * them. Splits on `;` and standalone newlines (not inside strings or blocks).
 */
function splitStatements(code: string): { body: string; hasDecl: boolean }[] {
  const stmts: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inTemplate = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const prev = i > 0 ? code[i - 1] : "";

    if (inString) {
      current += ch;
      if (ch === stringChar && prev !== "\\") { inString = false; stringChar = ""; }
      continue;
    }
    if (inTemplate) {
      current += ch;
      if (ch === "`" && prev !== "\\") inTemplate = false;
      continue;
    }

    // Enter string
    if (ch === '"' || ch === "'" || ch === "`") {
      if (ch === "`") inTemplate = true;
      else { inString = true; stringChar = ch; }
      current += ch;
      continue;
    }

    // Track brace depth
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") depth--;

    // Semicolon at depth 0 = statement boundary
    if (ch === ";" && depth === 0) {
      stmts.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  const leftover = current.trim();
  if (leftover) stmts.push(leftover);

  // Further split on newlines for statements not inside braces
  const result: string[] = [];
  for (const s of stmts) {
    if (s.includes("\n") && depth === 0) {
      // Only split on newlines if not inside braces
      const lines = s.split("\n").map(l => l.trim()).filter(Boolean);
      result.push(...lines);
    } else {
      result.push(s);
    }
  }

  return result.map(s => ({
    body: s,
    hasDecl: /^\s*(let|const|var)\s/.test(s),
  }));
}

/**
 * Auto-format a result value for display.
 * Objects and arrays → JSON.stringify with 2-space indent.
 * Strings and primitives → return as-is string representation.
 */
function autoFormat(result: unknown): string {
  if (result === undefined) return "undefined";
  if (result === null) return "null";
  if (typeof result === "object") {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMeteorShellTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "meteor_shell",
    label: "Meteor Shell",
    description: [
      "Run arbitrary JavaScript code on a live Meteor server (control-tower or daemon)",
      "via the eval.server DDP method. Returns { result, error } where exactly one",
      "is non-null.",
      "",
      "Multi-statement: splits code on `;` and newlines, evals sequentially.",
      "`let`/`const`/`var` declarations are hoisted so subsequent statements",
      "can reference them. Returns the last statement's result.",
      "",
      "Auto-format: objects and arrays get JSON.stringify with 2-space indent.",
      "Strings and primitives are returned as-is.",
      "",
      "target: 'all' fans to control + daemon + live in parallel.",
      "The target server must have the eval.server DDP method registered.",
      "Currently available on control-tower (after this deployment).",
    ].join("\n"),
    promptSnippet: "meteor_shell <code> on control|daemon|live|all",
    promptGuidelines: [
      "Use meteor_shell to run JS expressions on a live Meteor server for debugging.",
      "Target 'control' for control-tower, 'daemon' for the daemon, 'all' for all three.",
      "Use multi-statement blocks for setup + query patterns.",
      "The code runs server-side with full Meteor context — be careful with mutations.",
      "Only localhost connections are accepted by eval.server (safety gate).",
    ],
    parameters: Type.Object({
      code: Type.String({
        description: "JavaScript code to evaluate. Multi-statement blocks supported — split on ; and newlines. let/const/var declarations are hoisted for subsequent statements.",
      }),
      target: Type.Optional(Type.String({
        description: "Which server to target: 'control', 'daemon', 'live', or 'all' (fans to all three). Default: 'control'.",
        default: "control",
      })),
    }),

    async execute(_toolCallId, params) {
      const target = (params.target as string) ?? "control";
      const code = String(params.code ?? "").trim();

      if (!code) {
        return {
          content: [{ type: "text", text: "code is required" }],
          details: { error: "missing code" },
        };
      }

      const validTargets = ["control", "daemon", "live", "all"];
      if (!validTargets.includes(target)) {
        return {
          content: [{ type: "text", text: `target must be one of: ${validTargets.join(', ')}, got '${target}'` }],
          details: { error: "invalid target" },
        };
      }

      // ── target: 'all' — fan to control + daemon + live ──────────────
      if (target === "all") {
        const fanTargets = ["control", "daemon", "live"] as const;
        const results: Record<string, unknown> = {};
        for (const t of fanTargets) {
          const fanResult = await evalOnTarget(t, code);
          results[t] = fanResult;
        }
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: { target: "all", method: "eval.server" },
        };
      }

      // ── single target ──────────────────────────────────────────────
      const result = await evalOnTarget(target, code);
      if (result.error) {
        return {
          content: [{ type: "text", text: `eval.server failed on ${target}: ${result.error}` }],
          details: { error: result.error, target },
        };
      }
      return {
        content: [{ type: "text", text: result.formatted ?? JSON.stringify(result.raw, null, 2) }],
        details: { target, method: "eval.server" },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Core eval
// ---------------------------------------------------------------------------

export async function evalOnTarget(target: string, code: string): Promise<{
  raw?: unknown;
  formatted?: string;
  error?: string;
}> {
  const client = getDDPClient(target);
  if (!client) {
    return { error: `No DDP client for '${target}'. Is DDP connected?` };
  }

  if (!client.isConnected) {
    return { error: `DDP to '${target}' is not connected.` };
  }

  // Wait for warm so eval.server has full server context
  await client.waitForWarm(5000);

  // ── Multi-statement: split, hoist declarations, eval sequentially ────
  const statements = splitStatements(code);
  if (statements.length <= 1) {
    // Single expression — eval directly
    try {
      const raw = await client.call("eval.server", code);
      return { raw, formatted: autoFormat(raw) };
    } catch (err: any) {
      return { error: err.message || String(err) };
    }
  }

  // Multi-statement: build a wrapped script that hoists declarations
  // and evals each statement sequentially, returning the last result.
  const hoistedDecls: string[] = [];
  const evalStmts: string[] = [];

  for (const stmt of statements) {
    if (stmt.hasDecl) {
      // Hoist: extract the declaration (without let/const/var) and wrap
      const declBody = stmt.body.replace(/^\s*(let|const|var)\s+/, "");
      hoistedDecls.push(declBody);
    } else {
      evalStmts.push(stmt.body);
    }
  }

  // Build the combined script
  const parts: string[] = [];
  for (const decl of hoistedDecls) {
    // Re-declare as var so it's visible to subsequent evals
    // (eval.server evals in a single context, but each statement is separate.
    //  We wrap everything in a single eval with IIFE.)
    parts.push(`var ${decl};`);
  }
  for (const stmt of evalStmts) {
    parts.push(stmt);
  }

  // If we have hoisted decls, wrap everything so the decls are in scope
  const combinedCode = parts.join(";\n");

  try {
    const raw = await client.call("eval.server", combinedCode);
    return { raw, formatted: autoFormat(raw) };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}
