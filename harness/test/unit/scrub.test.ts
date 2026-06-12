/**
 * bond-gate scrub unit tests (Tier 1).
 *
 * Tests secret scrubbing functions — isProtectedPath, inputLooksSensitive,
 * scrubText, scrubUnknown, scrubToolResult.
 *
 * Run:  npx tsx --test test/unit/scrub.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isProtectedPath,
  inputLooksSensitive,
  scrubText,
  scrubUnknown,
  scrubToolResult,
} from "../../extension/bond-gate/scrub.ts";

// ---------------------------------------------------------------------------
// isProtectedPath
// ---------------------------------------------------------------------------

describe("isProtectedPath", () => {
  it("detects /path/.env", () => {
    assert.equal(isProtectedPath("/home/user/.env"), true);
  });

  it("detects ~/.env", () => {
    assert.equal(isProtectedPath("~/.env"), true);
  });

  it("detects /path/.credentials", () => {
    assert.equal(isProtectedPath("/etc/.credentials"), true);
  });

  it("detects auth.json", () => {
    assert.equal(isProtectedPath("/home/user/auth.json"), true);
  });

  it("detects /id/ paths", () => {
    assert.equal(isProtectedPath("/home/user/id/secret.key"), true);
  });

  it("detects /trust/bonds/ paths", () => {
    assert.equal(isProtectedPath("/home/user/trust/bonds/koad.md.asc"), true);
  });

  it("detects /secrets/ paths", () => {
    assert.equal(isProtectedPath("/home/user/secrets/token"), true);
  });

  it("detects /private/ paths", () => {
    assert.equal(isProtectedPath("/home/user/private/key"), true);
  });

  it("does not flag normal paths", () => {
    assert.equal(isProtectedPath("/home/user/src/index.ts"), false);
    assert.equal(isProtectedPath("/tmp/data.json"), false);
  });

  it("handles non-string input", () => {
    assert.equal(isProtectedPath(null), false);
    assert.equal(isProtectedPath(undefined), false);
    assert.equal(isProtectedPath(42), false);
  });
});

// ---------------------------------------------------------------------------
// inputLooksSensitive
// ---------------------------------------------------------------------------

describe("inputLooksSensitive", () => {
  it("detects protected path in input values", () => {
    assert.equal(inputLooksSensitive({ path: "/home/user/.env" }), true);
  });

  it("detects protected path in array values", () => {
    assert.equal(inputLooksSensitive({ paths: ["/tmp/data", "/home/user/.credentials/token"] }), true);
  });

  it("detects env command in bash input", () => {
    assert.equal(inputLooksSensitive({ command: "env" }), true);
  });

  it("detects printenv command", () => {
    assert.equal(inputLooksSensitive({ command: "printenv" }), true);
  });

  it("detects cat .env in bash input", () => {
    assert.equal(inputLooksSensitive({ command: "cat .env" }), true);
  });

  it("detects BEGIN PRIVATE KEY in input", () => {
    assert.equal(inputLooksSensitive({ body: "-----BEGIN PRIVATE KEY-----" }), true);
  });

  it("does not flag normal inputs", () => {
    assert.equal(inputLooksSensitive({ path: "/home/user/src/index.ts" }), false);
    assert.equal(inputLooksSensitive({ command: "echo hello" }), false);
  });

  it("handles non-object input", () => {
    assert.equal(inputLooksSensitive(null), false);
    assert.equal(inputLooksSensitive("string"), false);
    assert.equal(inputLooksSensitive(42), false);
  });
});

// ---------------------------------------------------------------------------
// scrubText
// ---------------------------------------------------------------------------

describe("scrubText", () => {
  it("redacts private key blocks", () => {
    const { text, changed } = scrubText("-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----");
    assert.equal(changed, true);
    assert.ok(text.includes("redacted private key material"));
    assert.ok(!text.includes("abc123"));
  });

  it("redacts PGP private key blocks", () => {
    const { text, changed } = scrubText("-----BEGIN PGP PRIVATE KEY BLOCK-----\nsecret\n-----END PGP PRIVATE KEY BLOCK-----");
    assert.equal(changed, true);
    assert.ok(text.includes("redacted private key material"));
  });

  it("redacts OPENSSH private key blocks", () => {
    const { text, changed } = scrubText("-----BEGIN OPENSSH PRIVATE KEY-----\nkeydata\n-----END OPENSSH PRIVATE KEY-----");
    assert.equal(changed, true);
    assert.ok(text.includes("redacted private key material"));
  });

  it("redacts env var assignments with KEY/TOKEN/SECRET names", () => {
    const { text, changed } = scrubText("API_KEY=sk-abc123\nDB_PASSWORD=hunter2\n");
    assert.equal(changed, true);
    assert.ok(text.includes("API_KEY=[redacted]"));
    assert.ok(text.includes("DB_PASSWORD=[redacted]"));
    assert.ok(!text.includes("sk-abc123"));
    assert.ok(!text.includes("hunter2"));
  });

  it("redacts JSON secret values", () => {
    const { text, changed } = scrubText('{"apiKey": "sk-secret123", "name": "test"}');
    assert.equal(changed, true);
    assert.ok(text.includes('[redacted]'), `got: ${text}`);
    assert.ok(text.includes('"name": "test"'));
  });

  it("redacts protected paths", () => {
    const { text, changed } = scrubText("Reading /home/user/.env\nAlso /home/user/id/secret.key");
    assert.equal(changed, true);
    assert.ok(text.includes("redacted protected path"));
    assert.ok(text.includes("redacted protected path"), `got: ${text}`);
  });

  it("leaves normal text unchanged", () => {
    const { text, changed } = scrubText("Hello world\nThis is normal text.");
    assert.equal(changed, false);
    assert.equal(text, "Hello world\nThis is normal text.");
  });

  it("handles empty string", () => {
    const { text, changed } = scrubText("");
    assert.equal(changed, false);
  });
});

// ---------------------------------------------------------------------------
// scrubUnknown
// ---------------------------------------------------------------------------

describe("scrubUnknown", () => {
  it("scrubs strings", () => {
    const { result, changed } = scrubUnknown("API_KEY=secret123");
    assert.equal(changed, true);
    assert.ok((result as string).includes("[redacted]"));
  });

  it("scrubs arrays deeply", () => {
    const { result, changed } = scrubUnknown(["normal", "API_TOKEN=abc"]);
    assert.equal(changed, true);
    const arr = result as string[];
    assert.equal(arr[0], "normal");
    assert.ok(arr[1].includes("[redacted]"));
  });

  it("scrubs objects deeply", () => {
    const { result, changed } = scrubUnknown({ name: "test", env: "\nAPI_SECRET=xyz" });
    assert.equal(changed, true);
    const obj = result as Record<string, string>;
    assert.equal(obj.name, "test");
    assert.ok(obj.env.includes("[redacted]"));
  });

  it("leaves plain values unchanged", () => {
    const { result, changed } = scrubUnknown(42);
    assert.equal(changed, false);
    assert.equal(result, 42);
  });

  it("leaves null unchanged", () => {
    const { result, changed } = scrubUnknown(null);
    assert.equal(changed, false);
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// scrubToolResult
// ---------------------------------------------------------------------------

describe("scrubToolResult", () => {
  it("scrubs sensitive content", () => {
    const result = scrubToolResult(
      [{ type: "text", text: "API_KEY=sk-secret" }],
      {},
    );
    assert.ok(result);
    const text = result!.content[0].text;
    assert.ok(text?.includes("[redacted]"), `got: ${text}`);
  });

  it("returns undefined for clean content", () => {
    const result = scrubToolResult(
      [{ type: "text", text: "Hello world" }],
      { count: 42 },
    );
    assert.equal(result, undefined);
  });

  it("scrubs details", () => {
    const result = scrubToolResult(
      [{ type: "text", text: "ok" }],
      { secret: "\nAPI_KEY=abc", normal: 42 },
    );
    assert.ok(result);
    const details = result!.details;
    assert.ok((details.secret as string).includes("[redacted]"));
    assert.equal(details.normal, 42);
  });

  it("handles non-text content blocks", () => {
    const result = scrubToolResult(
      [{ type: "image", data: "base64..." }],
      {},
    );
    assert.equal(result, undefined);
  });

  it("preserves isError flag", () => {
    const result = scrubToolResult(
      [{ type: "text", text: "API_KEY=sk-abc" }],
      {},
      true,
    );
    assert.ok(result, "expected scrub result for API_KEY");
    assert.equal(result!.isError, true);
  });
});
