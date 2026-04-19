// Claude Code provider — self-auth pattern (harness-access architecture 2026-04-19)
//
// This provider is NOT the kingdom-wide insider default. It is a self-auth
// provider for koad's own use (and future sponsor-bonded keys — see below).
// It is only reachable via harnesses with allowed_users restriction.
//
// Shells to `claude --print` with the entity system prompt and user message.
// Tools constrained to Read, Glob, Grep — entity gets filesystem read access,
// zero write risk. Per §Special Harnesses in the harness-access horizon doc.
// Streams output chunks as they arrive from the subprocess stdout.
//
// options (from Meteor.settings providers.claude-code or the special harness config):
//   tools               — allowed tools array (default: ["Read","Glob","Grep"])
//   timeout_ms          — subprocess timeout in ms (default: 90000)
//   headroom_check_cmd  — command to check headroom (default: "juno usage --json")
//                         Only evaluated when used via the gate stack (koad-only harness).
//
// Self-auth: invokes `claude` using the logged-in user's own credentials.
// Currently: koad's Max plan, because only koad is in the allowed_users list.
// Future extension point: if Anthropic ToS or sponsor-bonded credentials open
// this path to sponsors, the credentials-injection hook goes here — the spawn
// call would receive credential env vars from the user's bonded key material,
// distinct from the host environment. No build work needed now; this comment
// is the reservation. See §The Claude Code Provider — Self-Auth Pattern in
// ~/.juno/horizons/30k/harness-access-architecture.md.
//
// Usage shape returned to harness pipeline:
//   { prompt_tokens: N, completion_tokens: N, total_tokens: N }
// Claude Code does not expose token counts directly; we estimate from text length.
// Copia reads the internal ledger for exact costing; this is a billing proxy only.

const { spawn } = require('child_process');

// Rate estimates for quota debit calculation (koad's own gas-tank, koad-only harness).
// These are internal estimation values for Copia's ledger; they are NOT the
// subscription-arbitrage rates from the earlier Max-20x design.
// Self-auth means koad's actual subscription absorbs the cost; these numbers
// are used only to track relative usage, not to bill anyone.
// Override via providers.claude-code.rates in Meteor.settings.
const DEFAULT_INPUT_RATE  = 3.0;    // $/M tokens — Sonnet API rate (conservative estimate)
const DEFAULT_OUTPUT_RATE = 15.0;   // $/M tokens — Sonnet API rate (conservative estimate)

// Rough token estimate: ~4 chars per token
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

KoadHarnessProviderClaudeCode = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const tools    = options.tools    || ['Read', 'Glob', 'Grep'];
    const timeout  = options.timeout_ms || 90000;

    // Extract the last user message from the prompt string
    // Prompt format: "Human: <msg>\n\nAssistant: <reply>\n\nHuman: <msg>"
    let userMessage = prompt;
    const humanParts = prompt.split(/\n\nHuman: /);
    if (humanParts.length > 1) {
      userMessage = humanParts[humanParts.length - 1].trim();
    } else if (prompt.startsWith('Human: ')) {
      userMessage = prompt.slice(7).trim();
    }

    // Build the full message: system prompt prepended inline
    // claude --print accepts the conversation as a single message
    const fullInput = systemPrompt
      ? `[System: ${systemPrompt}]\n\n${userMessage}`
      : userMessage;

    const args = [
      '--print',
      '--output-format', 'stream-json',
    ];

    // Constrain tools
    if (tools && tools.length > 0) {
      args.push('--allowedTools', tools.join(','));
    }

    const env = Object.assign({}, process.env, { FORCE_COLOR: '0' });

    let fullText    = '';
    let aborted     = false;
    let done        = false;
    let stderr      = '';
    let timedOut    = false;

    const child = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Send the message on stdin
    child.stdin.write(fullInput);
    child.stdin.end();

    // Timeout watchdog
    const watchdog = setTimeout(() => {
      if (!done && !aborted) {
        timedOut = true;
        child.kill('SIGTERM');
        onError(new Error(`claude-code: subprocess timed out after ${timeout}ms`));
      }
    }, timeout);

    // stdout — parse stream-json events
    let stdinBuffer = '';
    child.stdout.on('data', (chunk) => {
      if (aborted) return;
      stdinBuffer += chunk.toString();
      const lines = stdinBuffer.split('\n');
      stdinBuffer = lines.pop(); // keep partial line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // stream-json events: { type: "assistant", message: { content: [...] } }
          // or { type: "result", result: "..." }
          if (event.type === 'assistant' && event.message && event.message.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                fullText += block.text;
                onChunk(block.text);
              }
            }
          } else if (event.type === 'result') {
            // Final result event — may contain the complete text
            if (event.result && typeof event.result === 'string' && !fullText) {
              fullText = event.result;
              onChunk(event.result);
            }
          }
        } catch (e) {
          // Non-JSON line (progress indicators etc) — skip
        }
      }
    });

    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(watchdog);
      if (timedOut || aborted) return;

      if (!done) {
        done = true;
        if (code !== 0 && !fullText) {
          onError(new Error(`claude-code: process exited ${code}. stderr: ${stderr.slice(0, 200)}`));
        } else {
          // Build synthetic usage object from text estimates
          const inputTokens  = estimateTokens(fullInput);
          const outputTokens = estimateTokens(fullText);
          const usage = {
            prompt_tokens:     inputTokens,
            completion_tokens: outputTokens,
            total_tokens:      inputTokens + outputTokens,
            _rates: {
              input:  options.rates ? options.rates.input  : DEFAULT_INPUT_RATE,
              output: options.rates ? options.rates.output : DEFAULT_OUTPUT_RATE,
            },
          };
          onDone(fullText, usage);
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(watchdog);
      if (!aborted && !done) {
        done = true;
        onError(err);
      }
    });

    return () => {
      aborted = true;
      clearTimeout(watchdog);
      child.kill('SIGTERM');
    };
  },
};
