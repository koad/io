const https = require('https');

KoadHarnessProviderAnthropic = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return onError(new Error('ANTHROPIC_API_KEY not set'));
    }

    const model = options.model || 'claude-haiku-4-5-20251001';
    const maxTokens = options.maxTokens || 1024;

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

    const payload = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      stream: true,
    });

    let fullText = '';
    let aborted = false;
    let done = false;
    let usage = null;

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
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => onError(new Error(`anthropic ${res.statusCode}: ${body}`)));
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
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
              fullText += parsed.delta.text;
              onChunk(parsed.delta.text);
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              usage = parsed.usage;
            }
            if (parsed.type === 'message_start' && parsed.message && parsed.message.usage) {
              usage = { prompt_tokens: parsed.message.usage.input_tokens, completion_tokens: 0, total_tokens: parsed.message.usage.input_tokens };
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              usage = { prompt_tokens: (usage && usage.prompt_tokens) || 0, completion_tokens: parsed.usage.output_tokens || 0, total_tokens: ((usage && usage.prompt_tokens) || 0) + (parsed.usage.output_tokens || 0) };
            }
            if (parsed.type === 'message_stop' && !done) {
              done = true;
              onDone(fullText, usage);
            }
          } catch (e) {
            // skip malformed
          }
        }
      });

      res.on('end', () => {
        if (!aborted && !done && fullText) {
          done = true;
          onDone(fullText, usage);
        }
      });

      res.on('error', (err) => {
        if (!aborted) onError(err);
      });
    });

    req.on('error', (err) => {
      if (!aborted) onError(err);
    });

    req.write(payload);
    req.end();

    return () => {
      aborted = true;
      req.destroy();
    };
  },
};
