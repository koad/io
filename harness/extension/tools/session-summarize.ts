/**
 * session_summarize — summarize a pi session JSONL file without bloat.
 *
 * Wraps ~/.koad-io/commands/summarize/session/command.sh
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as cp from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import { clipText as clip } from "../utils/tool-render";

const HOME = os.homedir();
const SUMMARIZE_BIN = `${HOME}/.koad-io/commands/summarize/session/command.sh`;

export function registerSessionSummarizeTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "session_summarize",
    label: "Session Summarize",
    description: [
      "Summarize a pi session JSONL file — shows user messages, assistant responses,",
      "tool calls (name + args only, no content), and token stats.",
      "Strips thinking blocks, tool call content, and tool result bloat.",
    ].join("\n"),
    promptSnippet: "Summarize a session file (session_file)",
    promptGuidelines: [
      "Use session_summarize to get a clean overview of a past session.",
      "Pass the full path to a .jsonl session file.",
      "Output includes turns, tool calls, errors, compactions, tokens, and cost.",
    ],
    parameters: Type.Object({
      session_file: Type.String({
        description: "Path to the session JSONL file to summarize.",
      }),
    }),

    renderCall(args: any, theme: any) {
      const fpath = String(args.session_file || "").replace(/^\/home\/koad/, "~");
      return new Text([
        theme.fg("toolTitle", theme.bold("session_summarize ")) + theme.fg("dim", clip(fpath, 80)),
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const ok = details.exitCode === 0;
      const lines: string[] = [];
      if (ok) {
        lines.push(theme.fg("success", "✓ session summarized"));
        if (details.turns != null) lines.push(`  ${theme.fg("dim", `turns: ${details.turns} · tools: ${details.tool_calls} · tokens: ${details.tokens}`)}`);
        if (expanded && details.output) {
          lines.push(`  ${theme.fg("dim", clip(details.output, 480))}`);
        }
      } else {
        lines.push(theme.fg("error", `✗ summarize failed (exit ${details.exitCode}${details.stderr ? "" : " — no stderr, check session log"})`));
        if (details.stderr) lines.push(`  ${theme.fg("dim", clip(details.stderr, 200))}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let sessionFile = String(params.session_file || "").trim();
      if (!sessionFile) {
        throw new Error("session_summarize: session_file is required");
      }
      // Expand tilde — session_list outputs paths like ~/.koad-io/...
      if (sessionFile.startsWith("~")) {
        sessionFile = path.join(HOME, sessionFile.slice(1));
      }

      return new Promise((resolve) => {
        const child = cp.spawn("python3", [SUMMARIZE_BIN, sessionFile], {
          env: process.env,
          cwd: process.env.HARNESS_WORK_DIR || ctx?.cwd || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        const timeout = setTimeout(() => {
          child.kill("SIGTERM");
          resolve({
            content: [{ type: "text", text: "session_summarize timed out after 30s" }],
            details: { exitCode: 1, timedOut: true },
          });
        }, 30000);

        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        child.on("close", (code) => {
          clearTimeout(timeout);
          const exitCode = code ?? 1;
          const output = stdout.trim();

          // Parse summary stats from footer
          const turns = output.match(/Turns:\s+(\d+)/)?.[1];
          const toolCalls = output.match(/Tool calls:\s+(\d+)/)?.[1];
          const errors = output.match(/Errors:\s+(\d+)/)?.[1];
          const tokens = output.match(/Tokens:\s+([\d,]+)/)?.[1]?.replace(/,/g, "");
          const cost = output.match(/Cost:\s+\$([\d.]+)/)?.[1];

          resolve({
            content: [{ type: "text", text: exitCode === 0 ? output : `✗ exit ${exitCode}\n${stderr}` }],
            details: {
              exitCode,
              turns: turns ? Number(turns) : undefined,
              tool_calls: toolCalls ? Number(toolCalls) : undefined,
              errors: errors ? Number(errors) : undefined,
              tokens: tokens ? Number(tokens) : undefined,
              cost: cost ? Number(cost) : undefined,
              output: output.slice(0, 4000),
              stderr: stderr.slice(0, 500),
            },
          });
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          resolve({
            content: [{ type: "text", text: `session_summarize failed: ${err.message}` }],
            details: { exitCode: 1, stderr: err.message },
          });
        });
      });
    },
  });
}
