const http = require('http');
const { URL } = require('url');

KoadHarnessProviderOllama = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const endpoint = options.endpoint || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const model = options.model || 'llama3.2:latest';
    const url = new URL('/api/generate', endpoint);

    const payload = JSON.stringify({
      model,
      system: systemPrompt,
      prompt,
      stream: true,
      options: {
        temperature: options.temperature || 0.7,
        top_p: options.top_p,
        num_ctx: options.num_ctx || 4096,
      },
    });

    let fullText = '';
    let aborted = false;

    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => onError(new Error(`ollama ${res.statusCode}: ${body}`)));
        return;
      }

      let buffer = '';

      res.on('data', (chunk) => {
        if (aborted) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullText += parsed.response;
              onChunk(parsed.response);
            }
            if (parsed.done) {
              onDone(fullText);
            }
          } catch (e) {
            // skip malformed lines
          }
        }
      });

      res.on('end', () => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.response) {
              fullText += parsed.response;
              onChunk(parsed.response);
            }
            if (parsed.done) {
              onDone(fullText);
            }
          } catch (e) {
            // ignore
          }
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
