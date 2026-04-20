const https = require('https');

function _groqRequest({ apiKey, model, maxTokens, messages, tools }, onChunk) {
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

    let fullText     = '';
    let usage        = null;
    let aborted      = false;
    let finishReason = null;

    const toolCallMap = {};

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
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
        res.on('end', () => reject(new Error(`groq ${res.statusCode}: ${errBody}`)));
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
            const toolCalls = Object.keys(toolCallMap)
              .sort((a, b) => Number(a) - Number(b))
              .map(idx => toolCallMap[idx]);
            resolve({ text: fullText, usage, toolCalls, finishReason });
            continue;
          }

          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { continue; }

          if (parsed.x_groq && parsed.x_groq.usage) {
            usage = parsed.x_groq.usage;
          } else if (parsed.usage) {
            usage = parsed.usage;
          }

          const choice = parsed.choices && parsed.choices[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            if (onChunk) onChunk(delta.content);
          }

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

KoadHarnessProviderGroq = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const apiKey = options.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return onError(new Error('GROQ_API_KEY not set'));
    }

    const model     = options.model     || 'llama-3.1-70b-versatile';
    const maxTokens = options.maxTokens || 1024;
    const maxTurns  = options.maxToolTurns || 5;
    const toolReg   = options.tools;
    const toolCtx   = options.toolContext || {};

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

    messages.unshift({ role: 'system', content: systemPrompt });

    const groqTools = (toolReg && toolReg.toGroqFormat)
      ? toolReg.toGroqFormat()
      : null;

    let aborted = false;
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
        console.warn(`[harness:groq] tool turn limit (${maxTurns}) reached for entity=${toolCtx.entity || 'unknown'}`);
        onDone('', cumulativeUsage);
        return;
      }
      turnCount++;

      let turnResult;
      try {
        turnResult = await _groqRequest(
          { apiKey, model, maxTokens, messages: msgs, tools: groqTools },
          aborted ? null : onChunk,
        );
      } catch (err) {
        if (!aborted) onError(err);
        return;
      }

      if (aborted) return;

      accumulateUsage(turnResult.usage);

      const { text, toolCalls, finishReason } = turnResult;

      if (!toolReg || !toolCalls || toolCalls.length === 0 || finishReason !== 'tool_calls') {
        onDone(text, cumulativeUsage);
        return;
      }

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
          console.warn(`[harness:groq] tool handler error: tool=${tc.name} error=${err.message}`);
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

      const nextMessages = [
        ...msgs,
        assistantMsg,
        ...toolResultMsgs,
      ];

      await runTurns(nextMessages);
    }

    runTurns(messages).catch((err) => {
      if (!aborted) onError(err);
    });

    return () => {
      aborted = true;
    };
  },
};
