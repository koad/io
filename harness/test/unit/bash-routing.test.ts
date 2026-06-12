/**
 * bash-routing unit tests — FILESYSTEM-FREE.
 *
 * Tests lookupRouting() using env-var overrides only.
 * Never creates, writes, or deletes any file or directory.
 *
 * Run:  npx tsx --test test/unit/bash-routing.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { lookupRouting } from "../../extension/bond-gate/bash-routing.ts";

function savedEnv(): Record<string, string | undefined> {
  const keys = ["KOAD_IO_BASH_ROUTING_FILE", "KOAD_IO_PI_BASH_ROUTING_FILE"];
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

describe("lookupRouting", () => {
  let envSaved: Record<string, string | undefined>;

  beforeEach(() => {
    envSaved = savedEnv();
    delete process.env.KOAD_IO_BASH_ROUTING_FILE;
    delete process.env.KOAD_IO_PI_BASH_ROUTING_FILE;
  });

  afterEach(() => restoreEnv(envSaved));

  it("returns undefined when entity has no routing file", () => {
    assert.equal(lookupRouting("no-such-entity", "git", "git status"), undefined);
  });

  it("returns undefined when entity is empty string", () => {
    assert.equal(lookupRouting("", "git", "git status"), undefined);
  });

  it("returns undefined when commandWord is undefined", () => {
    assert.equal(lookupRouting("some-entity", undefined, "some command"), undefined);
  });
});
