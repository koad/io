import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCliArgs, renderText, runSummary } from "../host.mjs";
import { FLIGHT_LOG_SCHEMA_ID, resolveSummarySchema, SESSION_SUMMARY_SCHEMA_ID } from "../_schema.mjs";

let tempDir;
let previousRuntimePath;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koad-summary-"));
  previousRuntimePath = process.env.KOAD_IO_RUNTIME_PATH;
});

afterEach(() => {
  if (previousRuntimePath == null) delete process.env.KOAD_IO_RUNTIME_PATH;
  else process.env.KOAD_IO_RUNTIME_PATH = previousRuntimePath;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("summary host", () => {
  it("parses CLI shorthand parser form", () => {
    const parsed = parseCliArgs(["session", "/tmp/example.jsonl", "--format", "json", "--verbosity", "high"]);
    assert.equal(parsed.positionalParser, "session");
    assert.equal(parsed.target, "/tmp/example.jsonl");
    assert.equal(parsed.format, "json");
    assert.equal(parsed.verbosity, 2);
  });

  it("resolves specialized schemas for deterministic callers", () => {
    assert.equal(resolveSummarySchema(SESSION_SUMMARY_SCHEMA_ID).$id, SESSION_SUMMARY_SCHEMA_ID);
    assert.equal(resolveSummarySchema(FLIGHT_LOG_SCHEMA_ID).$id, FLIGHT_LOG_SCHEMA_ID);
  });

  it("autodetects markdown-frontmatter files", async () => {
    const file = path.join(tempDir, "brief.md");
    fs.writeFileSync(file, `---\ntitle: Example brief\npriority: high\n---\n\n# Heading\n\nBody text.\n`);
    const result = await runSummary({ target: file, parserName: null, positionalParser: null, format: "json", schema: "koad.summary.v1", verbosity: 1 });
    assert.equal(result.parser, "markdown-frontmatter");
    assert.equal(result.autodetected, true);
    assert.equal(result.data.attributes.title, "Example brief");
  });

  it("uses the message parser when inbox metadata is present", async () => {
    const inboxDir = path.join(tempDir, "messages", "juno");
    fs.mkdirSync(inboxDir, { recursive: true });
    const file = path.join(inboxDir, "note.md");
    fs.writeFileSync(file, `---\nfrom: vulcan\nto: juno\ntype: note\ntimestamp: 2026-07-16T23:39:25Z\n---\n\nHello there.\n`);
    const result = await runSummary({ target: file, parserName: null, positionalParser: null, format: "json", schema: "koad.summary.v1", verbosity: 1 });
    assert.equal(result.parser, "message");
    assert.equal(result.data.attributes.from, "vulcan");
  });

  it("summarizes session jsonl with conversation-only turns and explicit tool samples", async () => {
    const file = path.join(tempDir, "session.jsonl");
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session", id: "abc", timestamp: "2026-07-16T20:00:00Z", cwd: "/tmp/demo" }),
      JSON.stringify({ type: "message", timestamp: "2026-07-16T20:00:01Z", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "message", timestamp: "2026-07-16T20:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "toolCall", name: "read", arguments: { path: "/tmp/x" } }], usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.123456 } } } }),
      JSON.stringify({ type: "message", timestamp: "2026-07-16T20:00:03Z", message: { role: "toolResult", content: [{ type: "text", text: "huge tool blob" }] } }),
      "",
    ].join("\n"));
    const result = await runSummary({ target: file, parserName: "session", positionalParser: null, format: "json", schema: SESSION_SUMMARY_SCHEMA_ID, verbosity: 1 });
    assert.equal(result.parser, "session");
    assert.equal(result.schema, SESSION_SUMMARY_SCHEMA_ID);
    assert.equal(result.data.turns, 2);
    assert.equal(result.data.user_turns, 1);
    assert.equal(result.data.assistant_turns, 1);
    assert.equal(result.data.role_counts.toolResult, 1);
    assert.equal(result.data.tool_calls.length, 1);
    assert.equal(result.data.user_messages[0], "hello");
    const text = renderText(result);
    assert.match(text, /Turns: 2/);
    assert.match(text, /Tool calls: 1/);
    assert.match(text, /Tokens: 15/);
    assert.match(text, /Cost: \$0\.123456/);
    assert.match(text, /excluded from turn counts/);
  });

  it("summarizes flights with deterministic flight-log fields and shorthand resolution", async () => {
    process.env.KOAD_IO_RUNTIME_PATH = tempDir;
    const dispatchRoot = path.join(tempDir, "dispatches", "20260717T001256-710Z-vulcan-df3f55");
    fs.mkdirSync(dispatchRoot, { recursive: true });
    fs.writeFileSync(path.join(dispatchRoot, "dispatch.json"), JSON.stringify({
      id: "20260717T001256-710Z-vulcan-df3f55",
      entity: "vulcan",
      brief: "retrofit-summary-host",
      status: "landed",
      started: "2026-07-17T00:12:56Z",
      ended: "2026-07-17T00:32:08Z",
      note: "retrofit summary host",
      run_record_id: "run-123",
      model: "gpt-5.4",
    }, null, 2));
    fs.writeFileSync(path.join(dispatchRoot, "run.jsonl"), [
      JSON.stringify({ status: "running", outputs: {}, stats: {} }),
      JSON.stringify({
        run_id: "run-123",
        status: "complete",
        close_reason: "pi-rpc-dispatch",
        model: "gpt-5.4",
        outputs: {
          summary: "Landed.",
          final_text: "Full landing report",
          files_touched: ["/tmp/a", "/tmp/b"],
        },
        stats: {
          turns: 17,
          toolCalls: 9,
          inputTokens: 100,
          outputTokens: 25,
          cost: 0.5,
        },
      }),
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(dispatchRoot, "stdout.log"), "line one\nline two\nuseful tail\n");
    fs.writeFileSync(path.join(dispatchRoot, "stderr.log"), "warn tail\n");

    const result = await runSummary({ target: "df3f55", parserName: "flight", positionalParser: null, format: "json", schema: FLIGHT_LOG_SCHEMA_ID, verbosity: 1 });
    assert.equal(result.parser, "flight");
    assert.equal(result.schema, FLIGHT_LOG_SCHEMA_ID);
    assert.equal(result.data.dispatch_id, "20260717T001256-710Z-vulcan-df3f55");
    assert.equal(result.data.lookup.match_kind, "boundary-shorthand");
    assert.equal(result.data.run_log_kind, "stdout-log-fallback");
    assert.equal(result.data.completion_summary, "Landed.");
    assert.deepEqual(result.data.output_files, ["/tmp/a", "/tmp/b"]);
    assert.match(result.data.stderr_tail, /warn tail/);
    assert.match(result.data.transcript_tail, /useful tail/);
    assert.match(result.warnings.join("\n"), /stdout\.log fallback/);
  });

  it("falls back to structural summary for unknown files", async () => {
    const file = path.join(tempDir, "notes.txt");
    fs.writeFileSync(file, "line one\nline two\n");
    const result = await runSummary({ target: file, parserName: null, positionalParser: null, format: "json", schema: "koad.summary.v1", verbosity: 1 });
    assert.equal(result.parser, "structural");
    assert.ok(result.warnings.some((warning) => warning.includes("structural summary")));
  });
});
