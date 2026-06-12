/**
 * bash-denylist unit tests — FILESYSTEM-FREE.
 *
 * Tests loadDenyCommands() and loadDenyPatterns() using env vars only.
 * Never creates, writes, or deletes any file or directory.
 *
 * Run:  npx tsx --test test/unit/bash-denylist.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { loadDenyCommands, loadDenyPatterns } from "../../extension/bond-gate/bash-denylist.ts";

function savedEnv(): Record<string, string | undefined> {
  const keys = [
    "KOAD_IO_BASH_DENY_COMMANDS", "KOAD_IO_PI_BASH_DENY_COMMANDS",
    "KOAD_IO_BASH_DENY_PATTERNS", "KOAD_IO_PI_BASH_DENY_PATTERNS",
    "KOAD_IO_BASH_DENY_PATTERNS_FILE", "KOAD_IO_PI_BASH_DENY_PATTERNS_FILE",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearDenyEnv(): void {
  delete process.env.KOAD_IO_BASH_DENY_COMMANDS;
  delete process.env.KOAD_IO_PI_BASH_DENY_COMMANDS;
  delete process.env.KOAD_IO_BASH_DENY_PATTERNS;
  delete process.env.KOAD_IO_PI_BASH_DENY_PATTERNS;
  delete process.env.KOAD_IO_BASH_DENY_PATTERNS_FILE;
  delete process.env.KOAD_IO_PI_BASH_DENY_PATTERNS_FILE;
}

describe("loadDenyCommands", () => {
  let envSaved: Record<string, string | undefined>;

  beforeEach(() => { envSaved = savedEnv(); clearDenyEnv(); });
  afterEach(() => restoreEnv(envSaved));

  it("returns empty array when no env vars set", () => {
    assert.deepEqual(loadDenyCommands(), []);
  });

  it("loads from KOAD_IO_BASH_DENY_COMMANDS", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "docker,npm,yarn";
    assert.deepEqual(loadDenyCommands(), ["docker", "npm", "yarn"]);
  });

  it("lowercases all commands", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "Docker,NPM,Yarn";
    assert.deepEqual(loadDenyCommands(), ["docker", "npm", "yarn"]);
  });

  it("loads from KOAD_IO_PI_BASH_DENY_COMMANDS", () => {
    process.env.KOAD_IO_PI_BASH_DENY_COMMANDS = "curl,wget";
    assert.deepEqual(loadDenyCommands(), ["curl", "wget"]);
  });

  it("merges both env vars without duplicates", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "docker,npm";
    process.env.KOAD_IO_PI_BASH_DENY_COMMANDS = "npm,yarn";
    assert.deepEqual(loadDenyCommands(), ["docker", "npm", "yarn"]);
  });

  it("handles whitespace in env var", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "  docker , npm , yarn  ";
    assert.deepEqual(loadDenyCommands(), ["docker", "npm", "yarn"]);
  });

  it("handles colon and space separators", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "docker:npm yarn";
    assert.deepEqual(loadDenyCommands(), ["docker", "npm", "yarn"]);
  });

  it("handles empty string gracefully", () => {
    process.env.KOAD_IO_BASH_DENY_COMMANDS = "";
    assert.deepEqual(loadDenyCommands(), []);
  });
});

describe("loadDenyPatterns", () => {
  let envSaved: Record<string, string | undefined>;

  beforeEach(() => { envSaved = savedEnv(); clearDenyEnv(); });
  afterEach(() => restoreEnv(envSaved));

  it("returns empty array when no env vars set", () => {
    assert.deepEqual(loadDenyPatterns("some-entity"), []);
  });

  it("loads from KOAD_IO_BASH_DENY_PATTERNS", () => {
    process.env.KOAD_IO_BASH_DENY_PATTERNS = "docker\\s+rm,npm\\s+install";
    assert.deepEqual(loadDenyPatterns("some-entity"), ["docker\\s+rm", "npm\\s+install"]);
  });

  it("loads from KOAD_IO_PI_BASH_DENY_PATTERNS", () => {
    process.env.KOAD_IO_PI_BASH_DENY_PATTERNS = "curl\\s+.*api";
    assert.deepEqual(loadDenyPatterns("some-entity"), ["curl\\s+.*api"]);
  });

  it("merges both env vars without duplicates", () => {
    process.env.KOAD_IO_BASH_DENY_PATTERNS = "docker\\s+rm,npm\\s+install";
    process.env.KOAD_IO_PI_BASH_DENY_PATTERNS = "npm\\s+install,curl\\s+.*api";
    const result = loadDenyPatterns("some-entity");
    assert.equal(result.length, 3);
    assert.ok(result.includes("docker\\s+rm"));
    assert.ok(result.includes("npm\\s+install"));
    assert.ok(result.includes("curl\\s+.*api"));
  });

  it("returns env patterns only when entity is empty string", () => {
    process.env.KOAD_IO_BASH_DENY_PATTERNS = "env\\s+only";
    assert.deepEqual(loadDenyPatterns(""), ["env\\s+only"]);
  });
});
