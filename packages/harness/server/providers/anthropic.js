const https = require('https');

// _anthropicRequest(options, payload) → Promise<{ text, usage }>
//
// Fires a single streaming request to Anthropic /v1/messages and collects
// the full response. Used internally by KoadHarnessProviderAnthropic.stream()
// for both the initial turn and any tool-result follow-up turns.
//
// options: { apiKey, model, maxTokens, systemPrompt, messages, tools? }
// Returns Promise that resolves with { text, usage, toolUses: [{id, name, input}] }
// or rejects on HTTP or parse error.
function _anthropicRequest({ apiKey, model, maxTokens, systemPrompt, messages, tools }, onChunk) {
  return new Promise((resolve, reject) => {
    const body = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const payload = JSON.stringify(body);

    let fullText    = '';
    let usage       = null;
    let aborted     = false;

    // Accumulate tool_use blocks from streaming
    // Anthropic streams tool_use as content_block_start (with type+id+name),
    // then content_block_delta (with input_json_delta), then content_block_stop.
    const toolUses   = [];
    let currentBlock = null; // { index, id, name, inputJson }

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (d) => { errBody += d; });
        res.on('end', () => reject(new Error(`anthropic ${res.statusCode}: ${errBody}`)));
        return;
      }

      let buffer = '';
      let stopReason = null;

      res.on('data', (chunk) => {
        if (aborted) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { continue; }

          // ── Text deltas ──────────────────────────────────────────────────────
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta && parsed.delta.type === 'text_delta' && parsed.delta.text) {
              fullText += parsed.delta.text;
              if (onChunk) onChunk(parsed.delta.text);
            }
            // Tool input JSON accumulates in the current block
            if (parsed.delta && parsed.delta.type === 'input_json_delta' && currentBlock) {
              currentBlock.inputJson += parsed.delta.partial_json || '';
            }
          }

          // ── Tool use block start ─────────────────────────────────────────────
          if (parsed.type === 'content_block_start' && parsed.content_block) {
            if (parsed.content_block.type === 'tool_use') {
              currentBlock = {
                index:     parsed.index,
                id:        parsed.content_block.id,
                name:      parsed.content_block.name,
                inputJson: '',
              };
            }
          }

          // ── Tool use block stop ──────────────────────────────────────────────
          if (parsed.type === 'content_block_stop' && currentBlock) {
            // Finalize the accumulated block
            try {
              currentBlock.input = JSON.parse(currentBlock.inputJson || '{}');
            } catch (e) {
              currentBlock.input = {};
            }
            toolUses.push({ id: currentBlock.id, name: currentBlock.name, input: currentBlock.input });
            currentBlock = null;
          }

          // ── Usage ────────────────────────────────────────────────────────────
          if (parsed.type === 'message_start' && parsed.message && parsed.message.usage) {
            usage = {
              prompt_tokens:     parsed.message.usage.input_tokens,
              completion_tokens: 0,
              total_tokens:      parsed.message.usage.input_tokens,
            };
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            usage = {
              prompt_tokens:     (usage && usage.prompt_tokens) || 0,
              completion_tokens: parsed.usage.output_tokens || 0,
              total_tokens:      ((usage && usage.prompt_tokens) || 0) + (parsed.usage.output_tokens || 0),
            };
          }

          // ── Stop reason ──────────────────────────────────────────────────────
          if (parsed.type === 'message_delta' && parsed.delta && parsed.delta.stop_reason) {
            stopReason = parsed.delta.stop_reason;
          }
          if (parsed.type === 'message_stop') {
            resolve({ text: fullText, usage, toolUses, stopReason });
          }
        }
      });

      res.on('end', () => {
        if (!aborted) {
          resolve({ text: fullText, usage, toolUses, stopReason });
        }
      });

      res.on('error', (err) => {
        if (!aborted) reject(err);
      });
    });

    req.on('error', (err) => {
      if (!aborted) reject(err);
    });

    req.write(payload);
    req.end();
  });
}

KoadHarnessProviderAnthropic = {
  // stream(systemPrompt, prompt, onChunk, onDone, onError, options)
  //
  // options.tools — optional tool registry (from KoadHarnessToolCascade.load()).
  //   If provided and has native tools, those are registered with the API.
  //   When the model invokes a tool, the handler is called and the result is
  //   fed back to the model in a follow-up turn. Streaming continues until
  //   the model produces a final text response (stop_reason = "end_turn").
  //
  // options.toolContext — context object passed to tool handlers:
  //   { entity, sessionId, userId, settings }
  //
  // The tool loop is bounded by options.maxToolTurns (default: 5) to prevent
  // infinite loops if the model keeps requesting tools.
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return onError(new Error('ANTHROPIC_API_KEY not set'));
    }

    const model      = options.model     || 'claude-haiku-4-5-20251001';
    const maxTokens  = options.maxTokens || 1024;
    const maxTurns   = options.maxToolTurns || 5;
    const toolReg    = options.tools;       // KoadHarnessToolCascade registry or null
    const toolCtx    = options.toolContext || {};

    // Build Anthropic messages array from the harness prompt format.
    const messages = [];
    const turns = prompt.split(/\n\n(?=Human:|Assistant:)/);
    for (const turn of turns) {
      if (turn.startsWith('Human: ')) {
        messages.push({ role: 'user', content: turn.slice(7).trim() });
      } else if (turn.startsWith('Assistant:')) {
        const content = turn.slice(10).trim();
        if (content) {
          messages.push({ role: 'assistant', content });
        }
      }
    }

    // Normalize native tools for Anthropic format if a registry was provided.
    const anthropicTools = (toolReg && toolReg.toAnthropicFormat)
      ? toolReg.toAnthropicFormat()
      : null;

    let aborted = false;

    // Run the turn loop asynchronously. We use a Fiber-free async pattern
    // (Promise chain) and call onChunk / onDone / onError synchronously
    // from within Meteor.bindEnvironment at the end.
    //
    // Note: Meteor.bindEnvironment is not needed here because the harness.js
    // callers already operate inside the Meteor fiber context (bindEnvironment
    // is applied at the WebApp handler level). Node https callbacks fire outside
    // Meteor fibers — onChunk/onDone/onError are already bound at the call site.

    let turnCount = 0;
    let cumulativeUsage = null;

    function accumulateUsage(usage) {
      if (!usage) return;
      if (!cumulativeUsage) {
        cumulativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      }
      cumulativeUsage.prompt_tokens     += usage.prompt_tokens     || 0;
      cumulativeUsage.completion_tokens += usage.completion_tokens || 0;
      cumulativeUsage.total_tokens      += usage.total_tokens      || 0;
    }

    async function runTurns(msgs) {
      if (aborted) return;
      if (turnCount >= maxTurns) {
        // Exceeded tool turn limit — deliver what we have and stop
        console.warn(`[harness:anthropic] tool turn limit (${maxTurns}) reached for entity=${toolCtx.entity || 'unknown'}`);
        onDone('', cumulativeUsage);
        return;
      }
      turnCount++;

      let turnResult;
      try {
        turnResult = await _anthropicRequest(
          { apiKey, model, maxTokens, systemPrompt, messages: msgs, tools: anthropicTools },
          aborted ? null : onChunk,
        );
      } catch (err) {
        if (!aborted) onError(err);
        return;
      }

      if (aborted) return;

      accumulateUsage(turnResult.usage);

      const { text, toolUses, stopReason } = turnResult;

      // If no tools were invoked (or no tool registry), we're done.
      if (!toolReg || !toolUses || toolUses.length === 0 || stopReason !== 'tool_use') {
        onDone(text, cumulativeUsage);
        return;
      }

      // Tool turn: execute each tool, collect results, continue conversation.
      // Build the assistant message that includes both text (if any) and tool_use blocks.
      const assistantContent = [];
      if (text) {
        assistantContent.push({ type: 'text', text });
      }
      for (const tu of toolUses) {
        assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }

      // Build tool_result content blocks
      const toolResults = [];
      for (const tu of toolUses) {
        let result;
        try {
          result = await toolReg.invoke(tu.name, tu.input, toolCtx);
        } catch (err) {
          console.warn(`[harness:anthropic] tool handler error: tool=${tu.name} error=${err.message}`);
          result = { error: err.message };
        }

        const resultContent = typeof result === 'string'
          ? result
          : JSON.stringify(result);

        toolResults.push({
          type:        'tool_result',
          tool_use_id: tu.id,
          content:     resultContent,
        });
      }

      // Append assistant turn + user tool_results turn, then recurse
      const nextMessages = [
        ...msgs,
        { role: 'assistant', content: assistantContent },
        { role: 'user',      content: toolResults },
      ];

      await runTurns(nextMessages);
    }

    // Kick off the async turn loop. Errors surface via onError.
    runTurns(messages).catch((err) => {
      if (!aborted) onError(err);
    });

    // Return an abort function (called by harness on client disconnect)
    return () => {
      aborted = true;
    };
  },
};
