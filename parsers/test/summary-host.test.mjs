import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCliArgs, renderText, runSummary } from "../host.mjs";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koad-summary-"));
});

afterEach(() => {
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

  it("summarizes session jsonl and preserves compatibility footer lines", async () => {
    const file = path.join(tempDir, "session.jsonl");
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session", id: "abc", timestamp: "2026-07-16T20:00:00Z", cwd: "/tmp/demo" }),
      JSON.stringify({ type: "message", timestamp: "2026-07-16T20:00:01Z", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "message", timestamp: "2026-07-16T20:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "hi" }, { type: "toolCall", name: "read", arguments: { path: "/tmp/x" } }], usage: { input: 10, output: 5, totalTokens: 15, cost: { total: 0.123456 } } } }),
      "",
    ].join("\n"));
    const result = await runSummary({ target: file, parserName: "session", positionalParser: null, format: "json", schema: "koad.summary.v1", verbosity: 1 });
    assert.equal(result.parser, "session");
    const text = renderText(result);
    assert.match(text, /Turns: 2/);
    assert.match(text, /Tool calls: 1/);
    assert.match(text, /Tokens: 15/);
    assert.match(text, /Cost: \$0\.123456/);
  });

  it("falls back to structural summary for unknown files", async () => {
    const file = path.join(tempDir, "notes.txt");
    fs.writeFileSync(file, "line one\nline two\n");
    const result = await runSummary({ target: file, parserName: null, positionalParser: null, format: "json", schema: "koad.summary.v1", verbosity: 1 });
    assert.equal(result.parser, "structural");
    assert.ok(result.warnings.some((warning) => warning.includes("structural summary")));
  });
});
