/**
 * koad-io question tools — ask_question, wait_for_answer, answer_question.
 *
 * Talks to the daemon's /api/questions REST endpoints (VESTA-SPEC-165).
 * JSONL-backed question queue in ~/.koad-io/daemon/runtime/questions/index.jsonl.
 *
 * ask_question with wait:true long-polls until answered, with periodic
 * progress notifications to keep the harness transport warm.
 *
 * Migrated from ~/.forge/dance-hall/src/mcp/daemon-tools.js (questions section).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { clipText as clip, formatDurationSeconds as formatDuration } from "../utils/tool-render";

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_URL = process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function isAbortError(err: any): boolean {
  return err?.name === "AbortError" || err?.code === "ABORT_ERR";
}

function abortError(): Error {
  const err = new Error("aborted");
  (err as any).name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function daemonGet(urlPath: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${urlPath}`, { signal });
  if (!res.ok) throw new Error(`daemon GET ${urlPath}: HTTP ${res.status}`);
  return res.json();
}

async function daemonPost(urlPath: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `daemon POST ${urlPath}: HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Long-poll loop — shared by ask_question (wait:true) and wait_for_answer
// ---------------------------------------------------------------------------

async function pollUntilAnswered(
  question_id: string,
  maxSeconds: number,
  signal?: AbortSignal,
  sendProgress?: (elapsed: number, total: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  const POLL_MS = 3000;
  const maxAttempts = Math.ceil((maxSeconds * 1000) / POLL_MS);
  const startedAt = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(POLL_MS, signal);

    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    if (sendProgress) {
      try { await sendProgress(elapsed, maxSeconds); } catch (_) {}
    }

    let data: any;
    try {
      throwIfAborted(signal);
      data = await daemonGet(`/api/questions/${encodeURIComponent(question_id)}`, signal);
    } catch (err: any) {
      if (isAbortError(err)) throw err;
      continue; // daemon temporarily unreachable
    }

    const q = data?.question;
    if (!q) continue;

    if (q.status === "answered" || q.status === "cancelled") {
      return {
        question_id,
        status: q.status,
        answer: q.answer ?? null,
        answered_by: q.answered_by ?? null,
        answered_at: q.answered_at ?? null,
        answer_note: q.answer_note ?? null,
        elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
      };
    }
  }

  return {
    question_id,
    status: "timeout",
    answer: null,
    answered_by: null,
    answered_at: null,
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
    error: `No answer received within ${maxSeconds} seconds. Call wait_for_answer("${question_id}") to re-enter the wait — the question is still open.`,
  };
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const AskQuestionParams = Type.Object({
  from: Type.String({ description: 'Entity handle asking the question (e.g. "vulcan").' }),
  to: Type.String({ description: 'Entity handle or operator receiving the question (e.g. "juno", "koad").' }),
  question: Type.String({ description: "The question text." }),
  options: Type.Optional(Type.Array(Type.String(), { description: "Optional answer choices. If provided, answer must match one of these." })),
  workdir: Type.Optional(Type.String({ description: "Working directory context (e.g. current repo path)." })),
  context_ref: Type.Optional(Type.String({ description: "Optional reference string (e.g. brief slug, flight id) for context." })),
  wait: Type.Optional(Type.Boolean({ description: "If true (default), long-poll until answered/cancelled. If false, return immediately with question_id.", default: true })),
});

const WaitForAnswerParams = Type.Object({
  question_id: Type.String({ description: "The question_id returned by ask_question." }),
  max_seconds: Type.Optional(Type.Number({ description: "Max seconds to block (default 540 — ~9 min). Clamped to [10, 600].", minimum: 10, maximum: 600, default: 540 })),
});

const AnswerQuestionParams = Type.Object({
  question_id: Type.String({ description: "The question _id to answer." }),
  answer: Type.String({ description: "The answer text." }),
  answered_by: Type.String({ description: "Handle of entity/operator submitting the answer." }),
  answer_note: Type.Optional(Type.String({ description: "Optional free-text note sent alongside the answer." })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerQuestionTools(pi: ExtensionAPI): void {
  // ── ask_question ────────────────────────────────────────────────
  pi.registerTool({
    name: "ask_question",
    label: "Ask Question",
    description: "File a question to an operator or entity via the daemon questions queue. By default (wait: true) blocks until answered or cancelled (9-minute timeout). Set wait: false to fire-and-forget and return immediately. If the transport drops mid-wait, call wait_for_answer(question_id) to re-enter the wait.",
    promptSnippet: "Ask question to operator (from, to, question) — optionally block for answer",
    promptGuidelines: [
      "Use ask_question when a task genuinely needs human or peer input to continue.",
      "Default wait:true blocks until answered. Use wait:false for fire-and-forget.",
      "If transport drops mid-wait, recover with wait_for_answer(question_id).",
      "Do NOT file a duplicate question — the original is still alive.",
    ],
    parameters: AskQuestionParams,

    renderCall(args: any, theme: any) {
      const wait = args.wait !== false;
      const options = Array.isArray(args.options) && args.options.length > 0 ? ` · options: ${args.options.length}` : "";
      const mode = wait ? `wait: yes · timeout: ${formatDuration(540)} · Esc cancels local wait` : "wait: no · returns question_id immediately";
      return new Text([
        theme.fg("toolTitle", theme.bold("ask_question ")) + theme.fg("accent", `${args.from || "?"} → ${args.to || "?"}`),
        `  ${theme.fg("dim", `“${clip(args.question)}”`)}`,
        `  ${theme.fg("dim", `${mode}${options}`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const qid = details.question_id ?? "?";
      const from = details.from ?? "?";
      const to = details.to ?? "?";
      const elapsed = formatDuration(details.elapsed_seconds ?? 0);
      const timeout = formatDuration(details.timeout_seconds ?? 540);
      const prompt = clip(details.question);
      const lines: string[] = [];

      if (isPartial || details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for answer`));
        lines.push(`  ${theme.fg("accent", `${from} → ${to}`)} ${theme.fg("dim", `· id: ${qid} · elapsed: ${elapsed} · timeout: ${timeout}`)}`);
        if (prompt) lines.push(`  ${theme.fg("dim", `“${prompt}”`)}`);
        if (expanded && details.options?.length) lines.push(`  ${theme.fg("dim", `options: ${details.options.join(", ")}`)}`);
        if (expanded && details.context_ref) lines.push(`  ${theme.fg("dim", `context: ${details.context_ref}`)}`);
        if (expanded && details.workdir) lines.push(`  ${theme.fg("dim", `workdir: ${details.workdir}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "answered") {
        lines.push(theme.fg("success", `✓ answered by ${details.answered_by ?? "unknown"} after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· ${clip(details.answer ?? "(no text)")}`)}`);
        if (expanded && details.answer_note) lines.push(`  ${theme.fg("dim", `note: ${clip(details.answer_note)}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled" && details.interrupted) {
        lines.push(theme.fg("warning", `⏸ local wait cancelled`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· still open · elapsed: ${elapsed}`)}`);
        if (expanded && details.context_ref) lines.push(`  ${theme.fg("dim", `context: ${details.context_ref}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "timeout") {
        lines.push(theme.fg("warning", `⏳ still open after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· timeout: ${timeout} · use wait_for_answer to re-enter`)}`);
        if (expanded && details.context_ref) lines.push(`  ${theme.fg("dim", `context: ${details.context_ref}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      lines.push(theme.fg("success", `✓ question filed: ${qid}`));
      lines.push(`  ${theme.fg("dim", `${from} → ${to}${prompt ? ` · “${prompt}”` : ""}`)}`);
      if (expanded && details.options?.length) lines.push(`  ${theme.fg("dim", `options: ${details.options.join(", ")}`)}`);
      if (expanded && details.context_ref) lines.push(`  ${theme.fg("dim", `context: ${details.context_ref}`)}`);
      if (expanded && details.workdir) lines.push(`  ${theme.fg("dim", `workdir: ${details.workdir}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
      const { from, to, question, options, workdir, context_ref } = params;
      const wait = params.wait !== false;

      const body: Record<string, unknown> = { from, to, question };
      if (options) body.options = options;
      if (workdir) body.workdir = workdir;
      if (context_ref) body.context_ref = context_ref;

      const filed = await daemonPost("/api/questions", body, signal);
      const question_id = filed.question_id as string;
      const meta = {
        question_id,
        from,
        to,
        question,
        options,
        workdir,
        context_ref,
        timeout_seconds: 540,
      };

      if (!wait) {
        return {
          content: [{ type: "text", text: `question filed: \`${question_id}\`` }],
          details: { ...meta, status: "open" },
        };
      }

      let latestElapsed = 0;
      onUpdate?.({ content: [{ type: "text", text: "waiting..." }], details: { ...meta, status: "waiting", elapsed_seconds: latestElapsed } });

      let result: Record<string, unknown>;
      try {
        result = await pollUntilAnswered(
          question_id,
          540,
          signal,
          async (elapsed, total) => {
            latestElapsed = elapsed;
            onUpdate?.({ content: [{ type: "text", text: "waiting..." }], details: { ...meta, status: "waiting", elapsed_seconds: elapsed, timeout_seconds: total } });
          },
        );
      } catch (err: any) {
        if (isAbortError(err)) {
          return {
            content: [{ type: "text", text: `wait cancelled — question still open: \`${question_id}\`` }],
            details: { ...meta, status: "cancelled", interrupted: true, elapsed_seconds: latestElapsed },
          };
        }
        throw err;
      }

      if (result.status === "answered") {
        const ans = result.answer ?? "(no text)";
        const by = result.answered_by ?? "unknown";
        return {
          content: [{ type: "text", text: `✓ answered by ${by}: ${ans}` }],
          details: { ...meta, ...result, timeout_seconds: 540 },
        };
      }

      return {
        content: [{ type: "text", text: `⏳ question \`${question_id}\` still open after timeout` }],
        details: { ...meta, ...result, timeout_seconds: 540 },
      };
    },
  });

  // ── wait_for_answer ─────────────────────────────────────────────
  pi.registerTool({
    name: "wait_for_answer",
    label: "Wait For Answer",
    description: "Re-enter the wait on an existing question after a transport drop. Polls the daemon until answered/cancelled or max_seconds elapses. If you lost the question_id, query GET /api/questions?from=<entity>&status=open.",
    promptSnippet: "Re-enter wait for existing question (question_id)",
    promptGuidelines: [
      "Use after ask_question or a previous wait_for_answer drops mid-wait.",
      "The question stays alive in the daemon queue — this just re-enters the poll loop.",
      "Do NOT file a new ask_question for the same thing.",
    ],
    parameters: WaitForAnswerParams,

    renderCall(args: any, theme: any) {
      const timeout = Math.max(10, Math.min(600, args.max_seconds ?? 540));
      return new Text([
        theme.fg("toolTitle", theme.bold("wait_for_answer ")) + theme.fg("accent", `${args.question_id || "?"}`),
        `  ${theme.fg("dim", `re-enter existing question wait`)}`,
        `  ${theme.fg("dim", `timeout: ${formatDuration(timeout)} · Esc cancels local wait`)}`,
      ].join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded, isPartial }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const qid = details.question_id ?? "?";
      const from = details.from ? `${details.from} → ${details.to ?? "?"}` : null;
      const elapsed = formatDuration(details.elapsed_seconds ?? 0);
      const timeout = formatDuration(details.timeout_seconds ?? 540);
      const prompt = clip(details.question);
      const lines: string[] = [];

      if (isPartial || details.status === "waiting") {
        lines.push(theme.fg("warning", `⏳ waiting for answer`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· elapsed: ${elapsed} · timeout: ${timeout}`)}`);
        if (from) lines.push(`  ${theme.fg("dim", from + (prompt ? ` · “${prompt}”` : ""))}`);
        if (expanded && details.options?.length) lines.push(`  ${theme.fg("dim", `options: ${details.options.join(", ")}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "answered") {
        lines.push(theme.fg("success", `✓ answered by ${details.answered_by ?? "unknown"} after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· ${clip(details.answer ?? "(no text)")}`)}`);
        if (expanded && details.answer_note) lines.push(`  ${theme.fg("dim", `note: ${clip(details.answer_note)}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled" && details.interrupted) {
        lines.push(theme.fg("warning", `⏸ local wait cancelled`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· still open · elapsed: ${elapsed}`)}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "timeout") {
        lines.push(theme.fg("warning", `⏳ still open after ${elapsed}`));
        lines.push(`  ${theme.fg("accent", `id: ${qid}`)} ${theme.fg("dim", `· timeout: ${timeout}`)}`);
        if (expanded && from) lines.push(`  ${theme.fg("dim", from + (prompt ? ` · “${prompt}”` : ""))}`);
        return new Text(lines.join("\n"), 0, 0);
      }

      if (details.status === "cancelled") {
        return new Text(theme.fg("warning", `⏸ question cancelled: ${qid}`), 0, 0);
      }

      return new Text(theme.fg("success", `✓ question state loaded: ${qid}`), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate) {
      const { question_id } = params;
      const maxSeconds = Math.max(10, Math.min(600, params.max_seconds ?? 540));

      // Verify question exists
      let data: any;
      try {
        data = await daemonGet(`/api/questions/${encodeURIComponent(question_id)}`, signal);
      } catch (e: any) {
        if (isAbortError(e)) {
          return {
            content: [{ type: "text", text: `wait cancelled — question still open: \`${question_id}\`` }],
            details: { question_id, status: "cancelled", interrupted: true, timeout_seconds: maxSeconds, elapsed_seconds: 0 },
          };
        }
        throw new Error(`wait_for_answer: daemon unreachable — ${e.message}`);
      }

      const q = data?.question;
      if (!q) {
        throw new Error(`wait_for_answer: question ${question_id} not found`);
      }

      const meta = {
        question_id,
        from: q.from ?? null,
        to: q.to ?? null,
        question: q.question ?? null,
        options: q.options ?? null,
        timeout_seconds: maxSeconds,
      };

      // Already resolved
      if (q.status === "answered" || q.status === "cancelled") {
        return {
          content: [{ type: "text", text: `${q.status}: ${q.answer ?? "(no text)"}` }],
          details: {
            ...meta,
            status: q.status,
            answer: q.answer ?? null,
            answered_by: q.answered_by ?? null,
            elapsed_seconds: 0,
          },
        };
      }

      let latestElapsed = 0;
      onUpdate?.({ content: [{ type: "text", text: "waiting..." }], details: { ...meta, status: "waiting", elapsed_seconds: latestElapsed } });

      let result: Record<string, unknown>;
      try {
        result = await pollUntilAnswered(
          question_id,
          maxSeconds,
          signal,
          async (elapsed, total) => {
            latestElapsed = elapsed;
            onUpdate?.({ content: [{ type: "text", text: "waiting..." }], details: { ...meta, status: "waiting", elapsed_seconds: elapsed, timeout_seconds: total } });
          },
        );
      } catch (e: any) {
        if (isAbortError(e)) {
          return {
            content: [{ type: "text", text: `wait cancelled — question still open: \`${question_id}\`` }],
            details: { ...meta, status: "cancelled", interrupted: true, elapsed_seconds: latestElapsed },
          };
        }
        throw e;
      }

      if (result.status === "answered") {
        return {
          content: [{ type: "text", text: `✓ answered: ${result.answer}` }],
          details: { ...meta, ...result, timeout_seconds: maxSeconds },
        };
      }

      return {
        content: [{ type: "text", text: `⏳ question \`${question_id}\` still open after ${maxSeconds}s` }],
        details: { ...meta, ...result, timeout_seconds: maxSeconds },
      };
    },
  });

  // ── answer_question ─────────────────────────────────────────────
  pi.registerTool({
    name: "answer_question",
    label: "Answer Question",
    description: "Submit an answer to an open question in the daemon questions queue. Unblocks any waiting ask_question or wait_for_answer caller.",
    promptSnippet: "Answer open question (question_id, answer, answered_by)",
    promptGuidelines: [
      "Use when responding to a question filed by another entity.",
      "The blocked entity's ask_question/wait_for_answer will return with this answer.",
    ],
    parameters: AnswerQuestionParams,

    renderCall(args: any, theme: any) {
      return new Text([
        theme.fg("toolTitle", theme.bold("answer_question ")) + theme.fg("accent", `${args.question_id || "?"}`),
        `  ${theme.fg("dim", `${args.answered_by || "?"} · ${clip(args.answer)}`)}`,
        args.answer_note ? `  ${theme.fg("dim", `note: ${clip(args.answer_note)}`)}` : "",
      ].filter(Boolean).join("\n"), 0, 0);
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const lines = [
        theme.fg("success", `✓ answer submitted`),
        `  ${theme.fg("accent", `id: ${details.question_id ?? "?"}`)} ${theme.fg("dim", `· by: ${details.answered_by ?? "?"} · ${clip(details.answer ?? "")}`)}`,
      ];
      if (details.answer_note) lines.push(`  ${theme.fg("dim", `note: ${clip(details.answer_note)}`)}`);
      if (expanded && details.result?.status) lines.push(`  ${theme.fg("dim", `status: ${details.result.status}`)}`);
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params, _signal) {
      const { question_id, answer, answered_by, answer_note } = params;

      const body: Record<string, unknown> = { answer, answered_by };
      if (answer_note?.trim()) body.answer_note = answer_note.trim();

      const result = await daemonPost(
        `/api/questions/${encodeURIComponent(question_id)}/answer`,
        body,
      );

      return {
        content: [{ type: "text", text: `answer submitted for \`${question_id}\`` }],
        details: { ...result, result, question_id, answer, answered_by, answer_note: answer_note?.trim() || null },
      };
    },
  });
}
