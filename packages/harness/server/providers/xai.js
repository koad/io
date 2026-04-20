const https = require('https');

// _xaiRequest(options, onChunk) → Promise<{ text, usage, toolCalls, finishReason }>
//
// Fires a single streaming request to xAI /v1/chat/completions and collects
// the full response. Used internally by KoadHarnessProviderXai.stream()
// for both the initial turn and any tool-result follow-up turns.
//
// options: { apiKey, model, maxTokens, messages, tools? }
// Returns Promise that resolves with { text, usage, toolCalls: [{id, name, argumentsJson}], finishReason }
// or rejects on HTTP or parse error.
function _xaiRequest({ apiKey, model, maxTokens, messages, tools }, onChunk) {
  return new Promise((resolve, reject) => {
    const body = {
      model,
      max_tokens: maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const payload = JSON.stringify(body);

    let fullText    = '';
    let usage       = null;
    let aborted     = false;
    let finishReason = null;

    // Accumulate tool_calls from streaming (OpenAI-compatible format)
    // Each chunk may contain delta.tool_calls[{index, id, function: {name, arguments}}]
    // The name comes in the first chunk for that index; arguments accumulate across chunks.
    const toolCallMap = {}; // index → { id, name, argumentsJson }

    const req = https.request({
      hostname: 'api.x.ai',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (d) => { errBody += d; });
        res.on('end', () => reject(new Error(`xai ${res.statusCode}: ${errBody}`)));
        return;
      }

      let buffer = '';

      res.on('data', (chunk) => {
        if (aborted) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Build toolCalls array from accumulated map
            const toolCalls = Object.keys(toolCallMap)
              .sort((a, b) => Number(a) - Number(b))
              .map(idx => toolCallMap[idx]);
            resolve({ text: fullText, usage, toolCalls, finishReason });
            continue;
          }

          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { continue; }

          // ── Usage ────────────────────────────────────────────────────────────
          if (parsed.usage) {
            usage = parsed.usage;
          }

          const choice = parsed.choices && parsed.choices[0];
          if (!choice) continue;

          // ── Finish reason ────────────────────────────────────────────────────
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) continue;

          // ── Text deltas ──────────────────────────────────────────────────────
          if (delta.content) {
            fullText += delta.content;
            if (onChunk) onChunk(delta.content);
          }

          // ── Tool call deltas ─────────────────────────────────────────────────
          // delta.tool_calls is an array of partial chunks:
          //   { index, id?, function?: { name?, arguments? } }
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallMap[idx]) {
                toolCallMap[idx] = { id: '', name: '', argumentsJson: '' };
              }
              if (tc.id) {
                toolCallMap[idx].id = tc.id;
              }
              if (tc.function) {
                if (tc.function.name) {
                  toolCallMap[idx].name += tc.function.name;
                }
                if (tc.function.arguments) {
                  toolCallMap[idx].argumentsJson += tc.function.arguments;
                }
              }
            }
          }
        }
      });

      res.on('end', () => {
        if (!aborted) {
          const toolCalls = Object.keys(toolCallMap)
            .sort((a, b) => Number(a) - Number(b))
            .map(idx => toolCallMap[idx]);
          resolve({ text: fullText, usage, toolCalls, finishReason });
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

KoadHarnessProviderXai = {
  // stream(systemPrompt, prompt, onChunk, onDone, onError, options)
  //
  // options.tools — optional tool registry (from KoadHarnessToolCascade.load()).
  //   If provided and has native tools, those are registered with the API.
  //   When the model invokes a tool, the handler is called and the result is
  //   fed back to the model in a follow-up turn. Streaming continues until
  //   the model produces a final text response (finish_reason = "stop").
  //
  // options.toolContext — context object passed to tool handlers:
  //   { entity, sessionId, userId, settings }
  //
  // The tool loop is bounded by options.maxToolTurns (default: 5) to prevent
  // infinite loops if the model keeps requesting tools.
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const apiKey = options.apiKey || process.env.XAI_API_KEY;
    if (!apiKey) {
      return onError(new Error('XAI_API_KEY not set'));
    }

    const model     = options.model     || 'grok-2-latest';
    const maxTokens = options.maxTokens || 1024;
    const maxTurns  = options.maxToolTurns || 5;
    const toolReg   = options.tools;      // KoadHarnessToolCascade registry or null
    const toolCtx   = options.toolContext || {};

    // Build OpenAI-compatible messages array from the harness prompt format.
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

    // Prepend system message
    messages.unshift({ role: 'system', content: systemPrompt });

    // Normalize native tools for OpenAI/xAI format if a registry was provided.
    const xaiTools = (toolReg && toolReg.toGroqFormat)
      ? toolReg.toGroqFormat()
      : null;

    let aborted = false;

    let turnCount = 0;
    let cumulativeUsage = null;

    function accumulateUsage(usage) {
      if (!usage) return;
      if (!cumulativeUsage) {
        cumulativeUsage = {
          prompt_tokens:     0,
          completion_tokens: 0,
          total_tokens:      0,
        };
      }
      cumulativeUsage.prompt_tokens     += usage.prompt_tokens     || 0;
      cumulativeUsage.completion_tokens += usage.completion_tokens || 0;
      cumulativeUsage.total_tokens      += usage.total_tokens      || 0;
    }

    async function runTurns(msgs) {
      if (aborted) return;
      if (turnCount >= maxTurns) {
        console.warn(`[harness:xai] tool turn limit (${maxTurns}) reached for entity=${toolCtx.entity || 'unknown'}`);
        onDone('', cumulativeUsage);
        return;
      }
      turnCount++;

      let turnResult;
      try {
        turnResult = await _xaiRequest(
          { apiKey, model, maxTokens, messages: msgs, tools: xaiTools },
          aborted ? null : onChunk,
        );
      } catch (err) {
        if (!aborted) onError(err);
        return;
      }

      if (aborted) return;

      accumulateUsage(turnResult.usage);

      const { text, toolCalls, finishReason } = turnResult;

      // If finish_reason is not "tool_calls" or there are no tool calls, we're done.
      if (!toolReg || !toolCalls || toolCalls.length === 0 || finishReason !== 'tool_calls') {
        onDone(text, cumulativeUsage);
        return;
      }

      // Tool turn: build the assistant message with tool_calls, then execute each,
      // collect results as role:tool messages, and continue the conversation.

      // Build the assistant message (OpenAI-compatible tool_calls format)
      const assistantMsg = {
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.map(tc => ({
          id:       tc.id,
          type:     'function',
          function: {
            name:      tc.name,
            arguments: tc.argumentsJson,
          },
        })),
      };

      // Execute each tool and build tool result messages
      const toolResultMsgs = [];
      for (const tc of toolCalls) {
        let parsedArgs;
        try {
          parsedArgs = JSON.parse(tc.argumentsJson || '{}');
        } catch (e) {
          parsedArgs = {};
        }

        let result;
        try {
          result = await toolReg.invoke(tc.name, parsedArgs, toolCtx);
        } catch (err) {
          console.warn(`[harness:xai] tool handler error: tool=${tc.name} error=${err.message}`);
          result = { error: err.message };
        }

        const resultContent = typeof result === 'string'
          ? result
          : JSON.stringify(result);

        toolResultMsgs.push({
          role:         'tool',
          tool_call_id: tc.id,
          content:      resultContent,
        });
      }

      // Append assistant turn + tool result messages, then recurse
      const nextMessages = [
        ...msgs,
        assistantMsg,
        ...toolResultMsgs,
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
