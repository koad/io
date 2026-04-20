#!/usr/bin/env node
// memory-kek-ceremony.js — VESTA-SPEC-134 §6.2 Path C
// Local-harness KEK ceremony. Prompts for passphrase, derives KEK, returns status.
//
// Synthesis direction: ~/.juno/briefs/spec-134-oq5-synthesis.md
// Voice constraints: synthesis §Voice constraints (7 rules — non-negotiable)
//
// Exit codes:
//   0 — loaded, loaded-empty, or rotation-required (ceremony succeeded; harness proceeds)
//   1 — aborted (3 failures or user opt-out; harness proceeds without memories)
//   2 — revoked (bond check detected revocation; harness proceeds without memories)
//
// stdout: single JSON line — { status, kek_b64? } — kek_b64 only on loaded states
// stderr: ceremony UI + spinners (displayed to terminal; suppressed in non-TTY)
//
// Env:
//   KOAD_IO_MEMORY_FIRST_TIME_DEVICE  — set to "1" for first-time-on-device path
//   KOAD_IO_MEMORY_KEK_STATUS         — "revoked" triggers Scenario A revocation path
//   KOAD_IO_MEMORY_KEY_VERSION        — integer, server's current key_version
//   NO_COLOR                          — set to suppress ANSI output
//   KOAD_IO_MEMORY_CEREMONY_DEBUG     — set for verbose stderr debug output
//
// NOTE: actual Argon2id derivation and real KEK validation require a server
// connection (Phase 6). In Phase 5, this ceremony handles the UI protocol and
// returns a stub kek_b64. The harness wires the real derive in Phase 6.

'use strict';

const readline = require('readline');
const { createInterface } = readline;

// ── TTY + color detection ─────────────────────────────────────────────────────

const IS_TTY = process.stderr.isTTY === true;
const NO_COLOR = IS_TTY && !process.env.NO_COLOR
  ? false  // TTY with no explicit NO_COLOR → allow ANSI
  : true;  // non-TTY or NO_COLOR set → strip ANSI

// Unicode detection: check TERM and locale for braille spinner support.
// If TERM is 'dumb' or locale doesn't suggest UTF-8, fall back to ASCII.
const UNICODE = (() => {
  if (process.env.TERM === 'dumb') return false;
  const lang = (process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE || '').toUpperCase();
  if (lang.includes('UTF-8') || lang.includes('UTF8')) return true;
  // Fallback: many modern terminals use UTF-8 without LANG set; check TERM_PROGRAM
  const termProg = (process.env.TERM_PROGRAM || '').toLowerCase();
  if (termProg === 'iterm.app' || termProg === 'apple_terminal' || termProg.includes('kitty') || termProg.includes('tmux')) return true;
  // Default to ASCII when uncertain
  return false;
})();

// ── ANSI helpers ──────────────────────────────────────────────────────────────

function ansi(code) {
  if (NO_COLOR) return '';
  return `\x1b[${code}m`;
}

const RESET = ansi('0');
const DIM   = ansi('2');
const BOLD  = ansi('1');
const CYAN  = ansi('96'); // bright cyan — sovereignty line
const YELLOW= ansi('33'); // yellow — ambiguous failure (honest uncertainty)
const RED   = ansi('91'); // bright red — definitive abort first line
const GREEN = ansi('92'); // green — edge-case confirmation lines

// Box drawing: Unicode or ASCII fallback per synthesis §Visual structure
const BOX = UNICODE
  ? { tl: '\u250c', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' }
  : { tl: '+',      tr: '+',      bl: '+',       br: '+',      h: '-',      v: '|' };

const BOX_WIDTH = 52; // inner width (chars between border)
const INNER     = BOX_WIDTH - 2; // space inside borders (50 chars)

// ── Spinner ────────────────────────────────────────────────────────────────────
// Braille spinner (Unicode) or classic ASCII fallback (synthesis §Spinner behavior)

const SPINNER_FRAMES = UNICODE
  ? ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f']
  : ['|', '/', '-', '\\'];

const SPINNER_INTERVAL_MS = 80;

let _spinnerTimer = null;
let _spinnerFrame = 0;
let _spinnerActive = false;

function startSpinner(label) {
  if (!IS_TTY) {
    // Non-TTY: emit label as plain text, no spinner
    process.stderr.write(`${label}\n`);
    return;
  }
  _spinnerActive = true;
  _spinnerFrame  = 0;
  _spinnerTimer  = setInterval(() => {
    const frame = SPINNER_FRAMES[_spinnerFrame % SPINNER_FRAMES.length];
    _spinnerFrame++;
    process.stderr.write(`\r  ${label}  ${frame} `);
  }, SPINNER_INTERVAL_MS);
}

function stopSpinner() {
  if (_spinnerTimer) {
    clearInterval(_spinnerTimer);
    _spinnerTimer = null;
  }
  _spinnerActive = false;
  if (IS_TTY) {
    // Clear the spinner line
    process.stderr.write('\r\x1b[K');
  }
}

// Ensure spinner always clears on process exit/crash (synthesis §Spinner clears + resolves always)
process.on('exit', () => { if (_spinnerActive) stopSpinner(); });
process.on('SIGINT', () => { stopSpinner(); process.exit(1); });
process.on('uncaughtException', (err) => { stopSpinner(); process.stderr.write(`\n[ceremony] error: ${err.message}\n`); process.exit(1); });

// ── Box rendering ─────────────────────────────────────────────────────────────

function boxLine(content, colorFn) {
  // Pad content to INNER chars, wrap in box borders
  const plain = content.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for length calc
  const pad   = Math.max(0, INNER - plain.length);
  const col   = colorFn ? colorFn(content) : content;
  return `  ${DIM}${BOX.v}${RESET}${col}${' '.repeat(pad)}${DIM}${BOX.v}${RESET}`;
}

function boxTop() {
  return `  ${DIM}${BOX.tl}${BOX.h.repeat(INNER)}${BOX.tr}${RESET}`;
}

function boxBot() {
  return `  ${DIM}${BOX.bl}${BOX.h.repeat(INNER)}${BOX.br}${RESET}`;
}

function boxDiv() {
  return `  ${DIM}${BOX.v}${'─'.repeat(INNER)}${BOX.v}${RESET}`;
}

function boxBlank() {
  return boxLine(' '.repeat(INNER));
}

function renderBox(lines) {
  // lines: Array<{ text, color? }>
  const out = [boxTop()];
  for (const { text, color } of lines) {
    const content = ` ${text} `; // one-space indent per synthesis
    out.push(boxLine(content, color));
  }
  out.push(boxBot());
  return out.join('\n') + '\n';
}

// ── Passphrase input (hidden echo) ────────────────────────────────────────────
// Uses readline with muted output while the user types.

function readPassphrase(prompt) {
  return new Promise((resolve) => {
    if (!IS_TTY) {
      // Non-TTY: read a single line from stdin.
      // Prompt goes to stderr (stdout is reserved for JSON result).
      process.stderr.write(prompt);
      let line = '';
      let closed = false;

      process.stdin.setEncoding('utf8');
      function onData(chunk) {
        line += chunk;
        const nl = line.indexOf('\n');
        if (nl !== -1) {
          const result = line.slice(0, nl).replace(/\r$/, '');
          line = line.slice(nl + 1);
          cleanup();
          resolve(result);
        }
      }
      function onEnd() {
        if (!closed) {
          closed = true;
          cleanup();
          resolve(line.replace(/\r?\n$/, ''));
        }
      }
      function cleanup() {
        closed = true;
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.pause();
      }
      process.stdin.resume();
      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      return;
    }

    // TTY path: mute echo while reading (hidden echo per synthesis)
    const rl = createInterface({
      input:  process.stdin,
      output: process.stderr,
    });

    // Write prompt directly to stderr before rl takes over
    process.stderr.write(prompt);

    // Mute by replacing _writeToOutput — suppress all echo characters
    rl._writeToOutput = function (str) {
      // Suppress echo entirely (hidden passphrase input)
      // Allow only blank writes to proceed (some Node versions need this)
    };

    rl.question('', (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ── Argon2id derivation stub ──────────────────────────────────────────────────
// Phase 5: stub returns a deterministic placeholder KEK for testing the ceremony
// protocol. Phase 6 wires real argon2 (argon2-wasm-pro or system argon2).
// The stub allows ceremony tests to exercise all paths without argon2 dependency.
//
// In production Phase 6 wiring, this function is replaced by:
//   const argon2 = require('argon2-wasm-pro');
//   return argon2.hash({ pass: passphrase, salt, type: argon2.ArgonType.Argon2id,
//                        time: 3, mem: 65536, parallelism: 4, hashLen: 32 });

async function deriveKEK(passphrase, salt_b64) {
  // Phase 5 stub: use Node's built-in PBKDF2 as a stand-in for ceremony testing.
  // Real Argon2id parameters: t=3, m=65536, p=4, len=32 (SPEC-134 §6.2 Path B).
  // This stub is NOT cryptographically equivalent — Phase 6 replaces it.
  const crypto = require('crypto');
  const salt = Buffer.from(salt_b64 || 'phase5-stub-salt', 'base64').length > 0
    ? Buffer.from(salt_b64 || 'phase5-stub-salt', 'base64')
    : Buffer.from('phase5-stub-salt', 'utf8');

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, 100000, 32, 'sha256', (err, dk) => {
      if (err) reject(err);
      else resolve(dk.toString('base64'));
    });
  });
}

// ── KEK validation stub ────────────────────────────────────────────────────────
// Phase 5: validates by calling back to the kingdom's DDP API to attempt
// unwrapping the encrypted_kek_blob. Real wire in Phase 6.
// For Phase 5, we accept any non-empty passphrase as "valid" for ceremony testing.
// Real validation will call: MemoryStore.validateKEK(user_id, kek_b64)

async function validateKEK(kek_b64, opts) {
  // Phase 5 stub: always succeeds for non-empty kek.
  // opts: { encrypted_kek_blob, user_salt, key_version }
  // Returns { valid: Boolean, memoryCount: Number, rotationRequired: Boolean }
  if (!kek_b64 || kek_b64.length < 4) {
    return { valid: false };
  }
  // Stub: succeed with a mock count for testing
  return { valid: true, memoryCount: opts && opts.memoryCount != null ? opts.memoryCount : 1, rotationRequired: false };
}

// ── Ceremony states ────────────────────────────────────────────────────────────

const STATUS = {
  LOADED:            'loaded',
  LOADED_EMPTY:      'loaded-empty',
  ROTATION_REQUIRED: 'rotation-required',
  ABORTED:           'aborted',
  REVOKED:           'revoked',
};

// ── Main ceremony ─────────────────────────────────────────────────────────────
//
// Returns { status, kek_b64? } via stdout as a JSON line, then exits.

async function runCeremony() {
  const isFirstTimeDevice = process.env.KOAD_IO_MEMORY_FIRST_TIME_DEVICE === '1';
  const bondStatus        = (process.env.KOAD_IO_MEMORY_KEK_STATUS || '').toLowerCase();
  const keyVersion        = parseInt(process.env.KOAD_IO_MEMORY_KEY_VERSION || '1', 10) || 1;
  const saltB64           = process.env.KOAD_IO_MEMORY_SALT_B64 || '';
  const memoryCountHint   = parseInt(process.env.KOAD_IO_MEMORY_COUNT || '1', 10);
  const debug             = !!process.env.KOAD_IO_MEMORY_CEREMONY_DEBUG;

  if (debug) process.stderr.write(`[ceremony] debug: tty=${IS_TTY} unicode=${UNICODE} no_color=${NO_COLOR} first_time=${isFirstTimeDevice} bond=${bondStatus}\n`);

  // ── Scenario A: bond revoked at session start ─────────────────────────────
  if (bondStatus === 'revoked') {
    const msg = [
      'Memory features are inactive. Your memories are intact but the knowledge',
      'bond is not established on this device. Memories won\'t load this session.',
    ].join('\n');

    if (IS_TTY) {
      process.stderr.write('\n' + msg + '\n\n');
    } else {
      process.stderr.write(msg + '\n');
    }

    exitWith({ status: STATUS.REVOKED });
    return;
  }

  // ── First-time-on-device path (Iris §5 copy verbatim) ─────────────────────
  if (isFirstTimeDevice) {
    const boxContent = renderBox([
      { text: `${BOLD}memory passphrase${RESET}`,  color: null },
      { text: '─'.repeat(INNER - 2), color: (t) => `${DIM}${t}${RESET}` },
      { text: 'I don\'t have your memories on this device yet.',           color: null },
      { text: '',                                                           color: null },
      { text: 'Provide your passphrase to establish this device and load', color: null },
      { text: 'your memories, or continue without them.',                  color: null },
      { text: '',                                                           color: null },
      { text: `${CYAN}Your passphrase never leaves this machine.${RESET}`,  color: null },
    ]);

    if (IS_TTY) process.stderr.write('\n' + boxContent);

    // Prompt with inline Enter-to-skip (synthesis §First-time copy — Enter to skip non-negotiable)
    const passphrase = await readPassphrase(
      IS_TTY
        ? `  Passphrase to establish this device [or Enter to skip]: `
        : `Passphrase to establish this device [or Enter to skip]: `
    );
    if (IS_TTY) process.stderr.write('\n');

    if (!passphrase) {
      exitWith({ status: STATUS.ABORTED });
      return;
    }

    // Derive + validate
    startSpinner('Establishing device');
    try {
      const kek_b64 = await deriveKEK(passphrase, saltB64);
      const result  = await validateKEK(kek_b64, { memoryCount: memoryCountHint });
      stopSpinner();

      if (!result.valid) {
        // Wrong passphrase on first-time-device — one attempt, then abort
        if (IS_TTY) {
          process.stderr.write(
            `\n${YELLOW}Memories unavailable. The passphrase may be wrong, or the memory record may${RESET}\n` +
            `${YELLOW}need attention. Your session will continue without prior memory loaded.${RESET}\n\n`
          );
        } else {
          process.stderr.write('Memories unavailable. Passphrase may be wrong or memory record needs attention.\n');
        }
        exitWith({ status: STATUS.ABORTED });
        return;
      }

      // Successful establish
      if (result.memoryCount === 0) {
        if (IS_TTY) process.stderr.write(`\n${GREEN}Memory key active. No memories yet.${RESET}\n\n`);
        else        process.stderr.write('Memory key active. No memories yet.\n');
        exitWith({ status: STATUS.LOADED_EMPTY, kek_b64 });
      } else if (result.rotationRequired) {
        if (IS_TTY) process.stderr.write(`\n${GREEN}Some memories require key rotation. Run \`memory rotate\` to restore them.${RESET}\n\n`);
        else        process.stderr.write('Some memories require key rotation. Run `memory rotate` to restore them.\n');
        exitWith({ status: STATUS.ROTATION_REQUIRED, kek_b64 });
      } else {
        // Silent success (synthesis §Success: silent)
        exitWith({ status: STATUS.LOADED, kek_b64 });
      }
    } catch (err) {
      stopSpinner();
      if (debug) process.stderr.write(`[ceremony] derive error: ${err.message}\n`);
      exitWith({ status: STATUS.ABORTED });
    }
    return;
  }

  // ── Routine session path ───────────────────────────────────────────────────
  // Box template (synthesis §Box content template verbatim):
  //
  //   +--------------------------------------------------+
  //   |  memory passphrase                               |
  //   |  ------------------------------------------------|
  //   |  Your memories are encrypted.                    |
  //   |  Your passphrase never leaves this machine.      |
  //   |                                                  |
  //   |  Passphrase to remember: _                       |
  //   +--------------------------------------------------+

  const MAX_ATTEMPTS = 3; // hardcoded per synthesis §Retry limit (non-configurable)
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    // Render box on first attempt OR after retry prompt accepted
    const boxContent = renderBox([
      { text: `${BOLD}memory passphrase${RESET}`,                                     color: null },
      { text: '─'.repeat(INNER - 2), color: (t) => `${DIM}${t}${RESET}` },
      { text: 'Your memories are encrypted.',                                          color: null },
      { text: `${CYAN}Your passphrase never leaves this machine.${RESET}`,            color: null },
      { text: '',                                                                       color: null },
    ]);

    if (IS_TTY) process.stderr.write('\n' + boxContent);

    const passphrase = await readPassphrase(
      IS_TTY
        ? `  Passphrase to remember: `
        : `Passphrase to remember: `
    );
    if (IS_TTY) process.stderr.write('\n');

    // Enter with no input on first attempt = opt-out (Iris voice constraint #6)
    if (!passphrase && attempt === 0) {
      exitWith({ status: STATUS.ABORTED });
      return;
    }
    if (!passphrase) {
      // Empty on retry attempt = treat as "no" opt-out
      exitWith({ status: STATUS.ABORTED });
      return;
    }

    attempt++;

    // Derive
    startSpinner('Deriving key');
    let kek_b64;
    try {
      kek_b64 = await deriveKEK(passphrase, saltB64);
    } catch (err) {
      stopSpinner();
      if (debug) process.stderr.write(`[ceremony] derive error: ${err.message}\n`);
      exitWith({ status: STATUS.ABORTED });
      return;
    }

    let result;
    try {
      result = await validateKEK(kek_b64, { memoryCount: memoryCountHint });
    } catch (err) {
      stopSpinner();
      if (debug) process.stderr.write(`[ceremony] validate error: ${err.message}\n`);
      exitWith({ status: STATUS.ABORTED });
      return;
    }
    stopSpinner();

    if (result.valid) {
      // Success paths
      if (result.memoryCount === 0) {
        if (IS_TTY) process.stderr.write(`\n${GREEN}Memory key active. No memories yet.${RESET}\n\n`);
        else        process.stderr.write('Memory key active. No memories yet.\n');
        exitWith({ status: STATUS.LOADED_EMPTY, kek_b64 });
        return;
      } else if (result.rotationRequired) {
        if (IS_TTY) process.stderr.write(`\n${GREEN}Some memories require key rotation. Run \`memory rotate\` to restore them.${RESET}\n\n`);
        else        process.stderr.write('Some memories require key rotation. Run `memory rotate` to restore them.\n');
        exitWith({ status: STATUS.ROTATION_REQUIRED, kek_b64 });
        return;
      } else {
        // Silent success (synthesis §Success: silent override of Muse checkmark)
        exitWith({ status: STATUS.LOADED, kek_b64 });
        return;
      }
    }

    // Failure path (synthesis §Failure copy: Iris's honest dual-path)
    // Yellow color = ambiguous uncertainty (honest — can't distinguish wrong passphrase from blob issue)
    if (IS_TTY) {
      process.stderr.write(
        `\n${YELLOW}Memories unavailable. The passphrase may be wrong, or the memory record may${RESET}\n` +
        `${YELLOW}need attention. Your session will continue without prior memory loaded.${RESET}\n\n`
      );
    } else {
      process.stderr.write('Memories unavailable. The passphrase may be wrong, or the memory record may need attention. Your session will continue without prior memory loaded.\n');
    }

    // Max attempts reached — abort with reassurance (synthesis §Max-retries abort)
    if (attempt >= MAX_ATTEMPTS) {
      if (IS_TTY) {
        process.stderr.write(
          `${RED}Memories not loaded for this session. Your memories remain${RESET}\n` +
          `encrypted and intact.\n\n`
        );
      } else {
        process.stderr.write('Memories not loaded for this session. Your memories remain encrypted and intact.\n');
      }
      exitWith({ status: STATUS.ABORTED });
      return;
    }

    // Retry prompt — default No (synthesis §Retry prompt: default N)
    let retryAnswer = '';
    if (IS_TTY) {
      retryAnswer = await readPassphrase('  Try again? [y/N] ');
      process.stderr.write('\n');
    }

    const retryYes = retryAnswer.trim().toLowerCase() === 'y';
    if (!retryYes) {
      // Enter or 'n' → abort (default-No honored per synthesis)
      exitWith({ status: STATUS.ABORTED });
      return;
    }
    // 'y' → loop back, re-render box
  }

  // Should not reach here (loop exhausts before this), but guard anyway
  exitWith({ status: STATUS.ABORTED });
}

// ── Exit helper ───────────────────────────────────────────────────────────────

function exitWith(result) {
  // Write result JSON to stdout for harness to consume
  process.stdout.write(JSON.stringify(result) + '\n');

  // Exit codes per spec
  switch (result.status) {
    case STATUS.LOADED:
    case STATUS.LOADED_EMPTY:
    case STATUS.ROTATION_REQUIRED:
      process.exit(0);
      break;
    case STATUS.ABORTED:
      process.exit(1);
      break;
    case STATUS.REVOKED:
      process.exit(2);
      break;
    default:
      process.exit(1);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
runCeremony().catch((err) => {
  stopSpinner();
  process.stderr.write(`[ceremony] unexpected error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({ status: STATUS.ABORTED }) + '\n');
  process.exit(1);
});
