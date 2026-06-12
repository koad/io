/**
 * bash-policy unit tests.
 *
 * Tests inspectBashCommand() — the function that decides whether a bash
 * command gets blocked, rerouted, or allowed through.
 *
 * Run:  node --test test/unit/bash-policy.test.ts
 * Watch: node --test --watch test/unit/bash-policy.test.ts
 *
 * No pi, no DDP, no entity, no filesystem needed.
 * Just set env vars to simulate different configurations.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { inspectBashCommand } from "../../extension/bond-gate/bash-policy.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function savedEnv(): Record<string, string | undefined> {
  const keys = [
    "ENTITY",
    "KOAD_IO_BASH_DENY_COMMANDS",
    "KOAD_IO_BASH_DENY_PATTERNS",
    "KOAD_IO_BASH_ROUTING_FILE",
    "KOAD_IO_HARNESS_EXEC_PATHS",
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

function blockFor(cmd: string, execScope = ["/"], entity = "test-entity"): string | undefined {
  const result = inspectBashCommand(cmd, "/tmp", execScope, entity);
  return result?.auditReason;
}

function assertBlocked(cmd: string, expectedReason: string, execScope = ["/"], entity = "test-entity"): void {
  const result = inspectBashCommand(cmd, "/tmp", execScope, entity);
  assert.ok(result, `expected "${cmd}" to be blocked but it passed`);
  assert.ok(
    result!.auditReason.includes(expectedReason) || result!.detail.includes(expectedReason),
    `blocked "${cmd}" but expected reason containing "${expectedReason}", got "${result!.auditReason}"`,
  );
}

function assertAllowed(cmd: string, execScope = ["/"], entity = "test-entity"): void {
  const result = inspectBashCommand(cmd, "/tmp", execScope, entity);
  assert.equal(result, undefined, `expected "${cmd}" to be allowed but got: ${result?.auditReason}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("inspectBashCommand", () => {
  let envSaved: Record<string, string | undefined>;

  beforeEach(() => {
    envSaved = savedEnv();
    process.env.ENTITY = "test-entity";
    delete process.env.KOAD_IO_BASH_DENY_COMMANDS;
    delete process.env.KOAD_IO_BASH_DENY_PATTERNS;
    delete process.env.KOAD_IO_BASH_ROUTING_FILE;
    delete process.env.KOAD_IO_HARNESS_EXEC_PATHS;
  });

  afterEach(() => {
    restoreEnv(envSaved);
  });

  // ── Malformed input ───────────────────────────────────────────────

  describe("malformed input", () => {
    it("blocks non-string input", () => {
      const result = inspectBashCommand(42, "/tmp", ["/"], "test");
      assert.ok(result);
      assert.ok(result!.auditReason.includes("malformed"));
    });

    it("blocks null input", () => {
      const result = inspectBashCommand(null, "/tmp", ["/"], "test");
      assert.ok(result);
      assert.ok(result!.auditReason.includes("malformed"));
    });

    it("blocks undefined input", () => {
      const result = inspectBashCommand(undefined, "/tmp", ["/"], "test");
      assert.ok(result);
      assert.ok(result!.auditReason.includes("malformed"));
    });

    it("blocks empty string", () => {
      const result = inspectBashCommand("", "/tmp", ["/"], "test");
      assert.ok(result);
      assert.ok(result!.auditReason.includes("empty"));
    });

    it("blocks whitespace-only", () => {
      const result = inspectBashCommand("   \n  ", "/tmp", ["/"], "test");
      assert.ok(result);
      assert.ok(result!.auditReason.includes("empty"));
    });

    it("blocks NUL bytes", () => {
      assertBlocked("echo hello\u0000world", "NUL");
    });
  });

  // ── Privilege escalation ──────────────────────────────────────────

  describe("privilege escalation", () => {
    it("blocks sudo", () => assertBlocked("sudo rm file", "privilege escalation"));
    it("blocks su", () => assertBlocked("su - root", "privilege escalation"));
    it("blocks doas", () => assertBlocked("doas rm file", "privilege escalation"));
    it("blocks sudo in pipeline", () => assertBlocked("echo test | sudo tee /etc/file", "privilege escalation"));
  });

  // ── Host-level commands ───────────────────────────────────────────

  describe("host-level commands", () => {
    it("blocks systemctl", () => assertBlocked("systemctl restart nginx", "host-level"));
    it("blocks shutdown", () => assertBlocked("shutdown -h now", "host-level"));
    it("blocks reboot", () => assertBlocked("reboot", "host-level"));
    it("blocks mount", () => assertBlocked("mount /dev/sda1 /mnt", "host-level"));
    it("blocks dd", () => assertBlocked("dd if=/dev/zero of=file bs=1M count=10", "host-level"));
    it("blocks killall", () => assertBlocked("killall node", "host-level"));
  });

  // ── Destructive deletion ──────────────────────────────────────────

  describe("destructive deletion", () => {
    it("blocks rm -rf /", () => assertBlocked("rm -rf /", "destructive rm -rf"));
    it("blocks rm -rf ~/", () => assertBlocked("rm -rf ~/", "destructive rm -rf"));
    it("blocks rm -rf /home", () => assertBlocked("rm -rf /home", "destructive rm -rf"));
    it("allows scoped rm", () => assertAllowed("rm file.txt"));
    it("allows rm -rf within scope", () => assertAllowed("rm -rf ./node_modules"));
  });

  // ── Daemon/control HTTP bypass ────────────────────────────────────

  describe("daemon/control HTTP bypass", () => {
    it("blocks curl to daemon health", () => {
      assertBlocked("curl http://10.10.10.10:28282/api/health", "daemon/control HTTP");
    });
    it("blocks wget to control tower", () => {
      assertBlocked("wget http://10.10.10.10:28283/api/sessions", "daemon/control HTTP");
    });
    it("allows curl to external URLs", () => {
      assertAllowed("curl https://example.com");
    });
  });

  // ── Git rerouting ─────────────────────────────────────────────────

  describe("git rerouting", () => {
    it("routes git via bash to koad-io tool", () => {
      assertBlocked("git status", "git through bash");
    });
    it("routes git commit", () => {
      assertBlocked("git commit -m 'test'", "git through bash");
    });
    it("does not block git in comments", () => {
      assertAllowed("echo 'use git to commit this'");
    });
  });

  // ── koad-io command rerouting ─────────────────────────────────────

  describe("koad-io rerouting", () => {
    it("routes koad-io via bash to typed tool", () => {
      assertBlocked("koad-io announce 'hello'", "koad-io through bash");
    });
  });

  // ── Filesystem discovery rerouting ────────────────────────────────

  describe("filesystem discovery rerouting", () => {
    it("routes grep", () => assertBlocked("grep -r 'pattern' .", "discovery through bash"));
    it("routes rg", () => assertBlocked("rg 'pattern'", "discovery through bash"));
    it("routes find", () => assertBlocked("find . -name '*.ts'", "discovery through bash"));
    it("routes fd", () => assertBlocked("fd 'test'", "discovery through bash"));
    it("routes ls via bash", () => assertBlocked("ls -la", "discovery through bash"));
    it("does not block ls in strings", () => assertAllowed("echo 'use ls to see files'"));
  });

  // ── File read rerouting ───────────────────────────────────────────

  describe("file read rerouting", () => {
    it("routes cat", () => assertBlocked("cat file.txt", "read through bash"));
    it("routes head", () => assertBlocked("head -20 file.txt", "read through bash"));
    it("routes tail", () => assertBlocked("tail -20 file.txt", "read through bash"));
  });

  // ── Entity launcher rerouting ─────────────────────────────────────

  describe("entity launcher rerouting", () => {
    it("routes dispatch call", () => assertBlocked("dispatch --entity vulcan", "entity launcher through bash"));
    it("routes vulcan call", () => assertBlocked("vulcan build", "entity launcher through bash"));
    it("routes juno call", () => assertBlocked("juno plan", "entity launcher through bash"));
    it("routes rooty call", () => assertBlocked("rooty restart", "entity launcher through bash"));
  });

  // ── cd scope enforcement ──────────────────────────────────────────

  describe("cd scope enforcement", () => {
    it("allows cd within exec scope", () => {
      assertAllowed("cd /tmp && echo ok", ["/tmp", "/home"]);
    });
    it("blocks cd outside exec scope", () => {
      assertBlocked("cd /etc && echo bad", "cd outside exec scope", ["/tmp"]);
    });
    it("allows cd to relative path within scope", () => {
      assertAllowed("cd subdir && echo ok", ["/tmp/subdir"]);
    });
  });

  // ── Interpreter secret access ─────────────────────────────────────

  describe("interpreter secret access", () => {
    it("blocks python reading /.env", () => {
      assertBlocked("python -c \"open('/.env').read()\"", "protected path");
    });
    it("blocks node reading /.credentials/secret", () => {
      assertBlocked("node -e \"require('fs').readFileSync('/.credentials/secret')\"", "protected path");
    });
    it("allows relative .env (not protected by absolute-path guard)", () => {
      assertAllowed("python -c \"open('.env').read()\"");
    });
    it("allows python without secret paths", () => {
      assertAllowed("python -c 'print(\"hello\")'");
    });
  });

  // ── Env-var denylist ──────────────────────────────────────────────

  describe("KOAD_IO_BASH_DENY_COMMANDS", () => {
    it("blocks commands in env denylist", () => {
      process.env.KOAD_IO_BASH_DENY_COMMANDS = "docker,npm";
      assertBlocked("docker ps", "env bash deny command");
    });
    it("allows commands not in denylist", () => {
      process.env.KOAD_IO_BASH_DENY_COMMANDS = "docker";
      assertAllowed("npm test");
    });
  });

  describe("KOAD_IO_BASH_DENY_PATTERNS", () => {
    it("blocks commands matching pattern", () => {
      process.env.KOAD_IO_BASH_DENY_PATTERNS = "docker\\s+rm";
      assertBlocked("docker rm container", "deny-pattern policy");
    });
    it("allows non-matching commands", () => {
      process.env.KOAD_IO_BASH_DENY_PATTERNS = "docker\\s+rm";
      assertAllowed("docker ps");
    });
  });

  // ── Simple allowed commands ───────────────────────────────────────

  describe("simple allowed commands", () => {
    it("allows echo", () => assertAllowed("echo hello"));
    it("allows npm test", () => assertAllowed("npm test"));
    it("allows meteor build", () => assertAllowed("meteor build --directory ../build"));
    it("allows git-like wrapper without git keyword", () => assertAllowed("npx something"));
    it("allows multi-segment with &&", () => assertAllowed("echo a && echo b"));
    it("allows multi-line commands", () => assertAllowed("echo a\necho b"));
  });
});
