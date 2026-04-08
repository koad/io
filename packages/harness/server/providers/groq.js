const https = require('https');

KoadHarnessProviderGroq = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const apiKey = options.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return onError(new Error('GROQ_API_KEY not set'));
    }

    const model = options.model || 'llama-3.1-70b-versatile';
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
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    let fullText = '';
    let aborted = false;
    let done = false;
    let usage = null;

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
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => onError(new Error(`groq ${res.statusCode}: ${body}`)));
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
            if (!done) {
              done = true;
              onDone(fullText, usage);
            }
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.x_groq && parsed.x_groq.usage) {
              usage = parsed.x_groq.usage;
            } else if (parsed.usage) {
              usage = parsed.usage;
            }
            const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
            if (delta && delta.content) {
              fullText += delta.content;
              onChunk(delta.content);
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
