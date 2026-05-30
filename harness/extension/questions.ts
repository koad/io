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
import { Type } from "typebox";

const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CONTROL_URL = process.env.KOAD_IO_CONTROL_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function daemonGet(urlPath: string): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${urlPath}`);
  if (!res.ok) throw new Error(`daemon GET ${urlPath}: HTTP ${res.status}`);
  return res.json();
}

async function daemonPost(urlPath: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  sendProgress?: (elapsed: number, total: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  const POLL_MS = 3000;
  const PROGRESS_MS = 30_000;
  const maxAttempts = Math.ceil((maxSeconds * 1000) / POLL_MS);
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, POLL_MS));

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const now = Date.now();

    if (sendProgress && (now - lastProgressAt) >= PROGRESS_MS) {
      try { await sendProgress(elapsed, maxSeconds); } catch (_) {}
      lastProgressAt = now;
    }

    let data: any;
    try {
      data = await daemonGet(`/api/questions/${encodeURIComponent(question_id)}`);
    } catch (_) {
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

    async execute(_toolCallId, params, _signal) {
      const { from, to, question, options, workdir, context_ref } = params;
      const wait = params.wait !== false;

      const body: Record<string, unknown> = { from, to, question };
      if (options) body.options = options;
      if (workdir) body.workdir = workdir;
      if (context_ref) body.context_ref = context_ref;

      const filed = await daemonPost("/api/questions", body);
      const question_id = filed.question_id as string;

      if (!wait) {
        return {
          content: [{ type: "text", text: `question filed: \`${question_id}\`` }],
          details: { question_id, status: "open" },
        };
      }

      const result = await pollUntilAnswered(question_id, 540);

      if (result.status === "answered") {
        const ans = result.answer ?? "(no text)";
        const by = result.answered_by ?? "unknown";
        return {
          content: [{ type: "text", text: `✓ answered by ${by}: ${ans}` }],
          details: result,
        };
      }

      return {
        content: [{ type: "text", text: `⏳ question \`${question_id}\` still open after timeout` }],
        details: result,
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

    async execute(_toolCallId, params, _signal) {
      const { question_id } = params;
      const maxSeconds = Math.max(10, Math.min(600, params.max_seconds ?? 540));

      // Verify question exists
      let data: any;
      try {
        data = await daemonGet(`/api/questions/${encodeURIComponent(question_id)}`);
      } catch (e: any) {
        throw new Error(`wait_for_answer: daemon unreachable — ${e.message}`);
      }

      const q = data?.question;
      if (!q) {
        throw new Error(`wait_for_answer: question ${question_id} not found`);
      }

      // Already resolved
      if (q.status === "answered" || q.status === "cancelled") {
        return {
          content: [{ type: "text", text: `${q.status}: ${q.answer ?? "(no text)"}` }],
          details: {
            question_id,
            status: q.status,
            answer: q.answer ?? null,
            answered_by: q.answered_by ?? null,
            elapsed_seconds: 0,
          },
        };
      }

      const result = await pollUntilAnswered(question_id, maxSeconds);

      if (result.status === "answered") {
        return {
          content: [{ type: "text", text: `✓ answered: ${result.answer}` }],
          details: result,
        };
      }

      return {
        content: [{ type: "text", text: `⏳ question \`${question_id}\` still open after ${maxSeconds}s` }],
        details: result,
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
        details: result,
      };
    },
  });
}
