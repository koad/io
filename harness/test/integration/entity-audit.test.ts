/**
 * bond-gate entity audit tests — READ-ONLY verification against REAL entities.
 *
 * Resolves the bond scope for each entity and verifies the gate
 * produces the expected shape. NEVER creates, modifies, or deletes
 * any entity directory. Tests pass/fail based on what's actually on disk.
 *
 * Run:  npx tsx --test test/integration/entity-audit.test.ts
 *
 * To audit a specific entity:
 *   npx tsx --test --test-name-pattern="vulcan" test/integration/entity-audit.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const HOME = os.homedir();

// ⚠ READ-ONLY — never writes, never deletes, never modifies
// ⚠ These are the REAL entities you care about

interface EntityAudit {
  name: string;
  exists: boolean;
  hasBonds: boolean;
  bondCount: number;
  scope: any | null;
  errors: string[];
}

async function auditEntity(entityName: string): Promise<EntityAudit> {
  const entityDir = path.join(HOME, `.${entityName}`);
  const bondsDir = path.join(entityDir, "trust", "bonds");

  const result: EntityAudit = {
    name: entityName,
    exists: fs.existsSync(entityDir),
    hasBonds: fs.existsSync(bondsDir),
    bondCount: 0,
    scope: null,
    errors: [],
  };

  if (!result.exists) {
    result.errors.push(`entity directory ~/.${entityName} does not exist`);
    return result;
  }

  if (!result.hasBonds) {
    result.errors.push("no trust/bonds directory");
    return result;
  }

  // Count bond files
  try {
    const entries = fs.readdirSync(bondsDir);
    result.bondCount = entries.filter(e => e.endsWith(".md.asc")).length;

    const unsigned = entries.filter(e => e.endsWith(".md") && !e.endsWith(".md.asc") && !entries.includes(e + ".asc"));
    if (unsigned.length > 0) {
      result.errors.push(`unsigned .md files (need .md.asc): ${unsigned.join(", ")}`);
    }
  } catch (err: any) {
    result.errors.push(`cannot read bonds dir: ${err.message}`);
  }

  // Resolve the gate
  try {
    const { resolveGate } = await import("../../extension/bond-gate/resolve.ts");
    const saved = { ...process.env };
    delete process.env.KOAD_IO_BOND_GATE_BYPASS;
    delete process.env.KOAD_IO_PI_BOND_GATE_BYPASS;
    delete process.env.KOAD_IO_HARNESS_READ_PATHS;
    delete process.env.KOAD_IO_HARNESS_WRITE_PATHS;
    delete process.env.KOAD_IO_HARNESS_EXEC_PATHS;
    delete process.env.KOAD_IO_BOND_GATE_ALLOW_BASH;
    delete process.env.KOAD_IO_BOND_GATE_ALLOW_DISPATCH;
    delete process.env.KOAD_IO_BOND_GATE_ALLOW_KOADIO_TOOLS;
    delete process.env.KOAD_IO_BOND_GATE_ALLOW_KOADIO_COMMANDS;
    delete process.env.HARNESS_WORK_DIR;

    result.scope = resolveGate(entityName, false);

    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    if (result.scope.errors?.length > 0) {
      result.errors.push(...result.scope.errors);
    }
  } catch (err: any) {
    result.errors.push(`resolveGate failed: ${err.message}`);
  }

  return result;
}

function gpgMissing(errors: string[]): string[] {
  return errors.filter(e => !e.includes("public key not in keyring"));
}

// ---------------------------------------------------------------------------
// Entity audit tests
// ---------------------------------------------------------------------------

describe("entity bond audit", () => {
  let audits: Record<string, EntityAudit> = {};
  let loaded = false;

  beforeEach(async () => {
    if (loaded) return;
    for (const entity of ["vulcan", "juno", "rooty", "mercury", "vesta", "salus", "argus", "muse", "iris", "sibyl"]) {
      audits[entity] = await auditEntity(entity);
    }
    loaded = true;
  });

  describe("vulcan", () => {
    it("exists on disk", () => {
      assert.ok(audits.vulcan.exists, audits.vulcan.errors.join("; "));
    });

    it("has trust bonds directory", () => {
      assert.ok(audits.vulcan.hasBonds, audits.vulcan.errors.join("; "));
    });

    it("resolves scope", () => {
      assert.ok(audits.vulcan.scope, "scope is null — resolveGate failed");
    });

    it("scope is not empty-default", () => {
      const scope = audits.vulcan.scope;
      if (!scope) return;
      // Vulcan may be env-var (unsigned bonds) or bonded
      const ok = scope.mode === "bonded" || scope.mode === "env-var" || scope.file.read.length > 0 || scope.file.write.length > 0;
      assert.ok(ok, `mode=${scope.mode} r${scope.file.read.length} w${scope.file.write.length}`);
    });
  });

  describe("juno", () => {
    it("exists on disk", () => {
      assert.ok(audits.juno.exists);
    });

    it("has trust bonds", () => {
      assert.ok(audits.juno.hasBonds);
    });

    it("has at least one signed bond", () => {
      assert.ok(audits.juno.bondCount > 0, `bond count: ${audits.juno.bondCount}`);
    });

    it("resolves without critical errors", () => {
      const critical = gpgMissing(audits.juno.errors);
      assert.equal(critical.length, 0, critical.join("; "));
    });
  });

  describe("rooty", () => {
    it("has trust bonds", () => {
      assert.ok(audits.rooty.hasBonds);
    });

    it("has at least one signed bond", () => {
      assert.ok(audits.rooty.bondCount > 0, `bond count: ${audits.rooty.bondCount}`);
    });
  });

  // Existence check for all other entities
  for (const entity of ["mercury", "vesta", "salus", "argus", "muse", "iris", "sibyl"]) {
    describe(entity, () => {
      it("exists on disk", () => {
        assert.ok(audits[entity]?.exists, `${entity} directory not found`);
      });

      it("has trust bonds directory", () => {
        assert.ok(audits[entity]?.hasBonds, `${entity} has no trust/bonds`);
      });
    });
  }
});
