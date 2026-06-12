/**
 * bond-gate types helpers unit tests.
 *
 * Tests the pure utility functions from types.ts — isUnder, isBlocked,
 * parsePathList, parseNameList, resolveToolPath, expandPath, normalizeFingerprint.
 *
 * Run:  node --test test/unit/types-helpers.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import { isUnder, isBlocked, parsePathList, parseNameList, resolveToolPath, expandPath, normalizeFingerprint, currentDeviceId } from "../../extension/bond-gate/types.ts";

const HOME = os.homedir();

describe("isUnder", () => {
  it("returns true when path is exactly the prefix", () => {
    assert.equal(isUnder("/home/user/project", ["/home/user/project"]), true);
  });

  it("returns true when path is inside a prefix", () => {
    assert.equal(isUnder("/home/user/project/src/file.ts", ["/home/user/project"]), true);
  });

  it("returns true when path matches one of multiple prefixes", () => {
    assert.equal(isUnder("/tmp/work/file.ts", ["/home/user", "/tmp/work"]), true);
  });

  it("returns false when path is outside all prefixes", () => {
    assert.equal(isUnder("/etc/passwd", ["/home/user", "/tmp"]), false);
  });

  it("returns false when path is a sibling (not under)", () => {
    assert.equal(isUnder("/home/user/other", ["/home/user/project"]), false);
  });

  it("returns false when path is parent of prefix", () => {
    assert.equal(isUnder("/home/user", ["/home/user/project"]), false);
  });

  it("handles trailing slashes in prefix", () => {
    assert.equal(isUnder("/home/user/project/src", ["/home/user/project/"]), true);
  });

  it("handles trailing slashes in path", () => {
    assert.equal(isUnder("/home/user/project/src/", ["/home/user/project"]), true);
  });

  it("returns true with empty prefixes edge case (first match wins)", () => {
    // A relative path resolves to absolute — this can be surprising
    // but isUnder treats empty prefix as root when resolved
    const result = isUnder("/home/user/project", [""]);
    // "" resolves to cwd via path.resolve("")
    assert.equal(result, false); // cwd is not typically a prefix of /home/user/project
  });
});

describe("isBlocked", () => {
  it("blocks path containing blocked pattern", () => {
    assert.equal(isBlocked("/home/user/.env", ["/.env"]), true);
  });

  it("blocks nested path with blocked pattern", () => {
    assert.equal(isBlocked("/home/user/project/.env", ["/.env"]), true);
  });

  it("blocks path containing .git directory", () => {
    assert.equal(isBlocked("/home/user/project/.git/config", ["/.git/"]), true);
  });

  it("does not block path without blocked pattern", () => {
    assert.equal(isBlocked("/home/user/project/src/index.ts", ["/.env", "/.git/"]), false);
  });

  it("does not block partial matches (env vs .env)", () => {
    assert.equal(isBlocked("/home/user/environment.ts", ["/.env"]), false);
  });

  it("blocks with multiple patterns", () => {
    const blocked = ["/.env", "/.credentials", "/id/", "/.git/"];
    assert.equal(isBlocked("/home/user/id/secret.key", blocked), true);
    assert.equal(isBlocked("/home/user/.credentials/token", blocked), true);
  });
});

describe("parsePathList", () => {
  it("parses colon-separated paths", () => {
    const result = parsePathList("/tmp:/home/user:/var/log");
    assert.equal(result.length, 3);
    assert.ok(result.every(p => path.isAbsolute(p)));
  });

  it("handles empty input", () => {
    assert.deepEqual(parsePathList(""), []);
    assert.deepEqual(parsePathList(undefined), []);
  });

  it("handles tilde expansion", () => {
    const result = parsePathList("~/projects");
    assert.equal(result[0], path.join(HOME, "projects"));
  });

  it("trims whitespace", () => {
    const result = parsePathList(" /tmp : /home ");
    assert.equal(result.length, 2);
    assert.equal(result[0], "/tmp");
    assert.equal(result[1], "/home");
  });

  it("filters empty segments", () => {
    const result = parsePathList("/tmp::/home:");
    assert.equal(result.length, 2);
  });
});

describe("parseNameList", () => {
  it("parses space-separated names", () => {
    assert.deepEqual(parseNameList("alpha beta gamma"), ["alpha", "beta", "gamma"]);
  });

  it("parses comma-separated names", () => {
    assert.deepEqual(parseNameList("alpha,beta,gamma"), ["alpha", "beta", "gamma"]);
  });

  it("parses colon-separated names", () => {
    assert.deepEqual(parseNameList("alpha:beta:gamma"), ["alpha", "beta", "gamma"]);
  });

  it("handles mixed separators", () => {
    const result = parseNameList("alpha, beta: gamma");
    assert.deepEqual(result, ["alpha", "beta", "gamma"]);
  });

  it("handles empty input", () => {
    assert.deepEqual(parseNameList(""), []);
    assert.deepEqual(parseNameList(undefined), []);
  });

  it("trims and filters empty", () => {
    assert.deepEqual(parseNameList("  alpha  ,, beta  "), ["alpha", "beta"]);
  });
});

describe("resolveToolPath", () => {
  it("resolves absolute paths as-is", () => {
    assert.equal(resolveToolPath("/etc/hosts", "/tmp"), "/etc/hosts");
  });

  it("resolves relative paths against cwd", () => {
    const result = resolveToolPath("file.txt", "/tmp");
    assert.equal(result, path.resolve("/tmp", "file.txt"));
  });

  it("expands tilde", () => {
    assert.equal(resolveToolPath("~", "/tmp"), HOME);
    assert.equal(resolveToolPath("~/projects", "/tmp"), path.join(HOME, "projects"));
  });
});

describe("expandPath", () => {
  it("expands tilde", () => {
    assert.equal(expandPath("~"), HOME);
    assert.equal(expandPath("~/projects"), path.join(HOME, "projects"));
  });

  it("resolves relative paths to absolute", () => {
    const result = expandPath("relative/path");
    assert.ok(path.isAbsolute(result));
  });

  it("keeps absolute paths", () => {
    assert.equal(expandPath("/etc"), "/etc");
  });
});

describe("normalizeFingerprint", () => {
  it("lowercases and strips whitespace", () => {
    assert.equal(normalizeFingerprint("  ABC123  DEF456  "), "abc123def456");
  });

  it("returns undefined for empty input", () => {
    assert.equal(normalizeFingerprint(""), undefined);
    assert.equal(normalizeFingerprint(undefined), undefined);
  });

  it("returns undefined for whitespace-only", () => {
    assert.equal(normalizeFingerprint("   "), undefined);
  });
});

describe("currentDeviceId", () => {
  it("returns the hostname", () => {
    assert.equal(currentDeviceId(), os.hostname());
  });
});
