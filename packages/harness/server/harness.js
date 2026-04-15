const fs = require('fs');

/*
 * koad:harness — Entity conversation harness for Meteor
 *
 * Configure via Meteor.settings.harnesses (array of harness configs):
 *
 *   {
 *     "harnesses": [
 *       {
 *         "path": "/harness/jesus",
 *         "entities": ["jesus"],
 *         "entityBaseDir": "/home/koad",
 *         "cacheTTL": 300000,
 *         "provider": {
 *           "default": "xai",
 *           "xai": { "model": "grok-3", "maxTokens": 1024 }
 *         },
 *         "session": { "ttl": 1800000, "maxMessages": 50 },
 *         "rateLimits": { "enabled": false },
 *         "inputFilter": { "maxLength": 2000 }
 *       }
 *     ]
 *   }
 *
 * Each harness mounts at its own path prefix and serves its own set of entities.
 * Routes per harness:
 *   GET  {path}/health
 *   GET  {path}/entities
 *   GET  {path}/entities/:handle
 *   GET  {path}/entities/:handle/avatar
 *   POST {path}/chat
 */

class HarnessInstance {
  constructor(config) {
    this.config = config;
    this.prefix = config.path || '/harness';
    this.sessions = new KoadHarnessSessionStore(config.session || {});
    this.rateLimiter = new KoadHarnessRateLimiter(config.rateLimits || {});
    this.startedAt = Date.now();
    this.verbose = config.verbose !== false;
    this.providerDown = false;
    this.providerDownSince = null;
    this.providerDownRetryAfter = 60000; // retry provider after 1 min
  }

  log(...args) {
    if (this.verbose) console.log(`[harness:${this.prefix}]`, ...args);
  }

  logErr(...args) {
    if (this.verbose) console.error(`[harness:${this.prefix}]`, ...args);
  }

  matches(url) {
    return url === this.prefix || url.startsWith(this.prefix + '/');
  }

  routePath(url) {
    // Strip prefix and query string
    let path = url.slice(this.prefix.length) || '/';
    const qIdx = path.indexOf('?');
    const query = {};
    if (qIdx !== -1) {
      const qs = path.slice(qIdx + 1);
      path = path.slice(0, qIdx);
      for (const pair of qs.split('&')) {
        const [k, v] = pair.split('=');
        if (k) query[decodeURIComponent(k)] = v !== undefined ? decodeURIComponent(v) : '';
      }
    }
    const segments = path.split('/').filter(Boolean);
    return { path: '/' + segments.join('/'), segments, query };
  }

  json(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  setCors(res, req) {
    const origin = req.headers.origin;
    const origins = this.config.cors && this.config.cors.origins;
    if (origin && origins && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) {
          reject(new Error('Body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  // --- Route handlers ---

  handleHealth(req, res) {
    this.json(res, 200, {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      sessions: this.sessions.count,
      entities: this.config.entities,
      provider: this.config.provider.default,
    });
  }

  async handleEntities(req, res, query) {
    const level = query && query.level !== undefined ? parseInt(query.level, 10) : undefined;
    const entities = await KoadHarnessEntityLoader.loadAll(
      this.config.entities, this.config.entityBaseDir, this.config.cacheTTL || 300000
    );
    const list = Object.values(entities).map(e => KoadHarnessEntityLoader.getClientInfo(e, level, this.prefix));
    this.json(res, 200, list);
  }

  async handleEntitySingle(req, res, handle, query) {
    if (!this.config.entities.includes(handle)) {
      return this.json(res, 404, { error: 'Not found' });
    }
    const entity = await KoadHarnessEntityLoader.getEntity(
      handle, this.config.entityBaseDir, this.config.cacheTTL || 300000
    );
    if (!entity) return this.json(res, 404, { error: 'Not found' });
    const level = query && query.level !== undefined ? parseInt(query.level, 10) : undefined;
    this.json(res, 200, KoadHarnessEntityLoader.getClientInfo(entity, level, this.prefix));
  }

  async handleAvatar(req, res, handle) {
    if (!this.config.entities.includes(handle)) {
      return this.json(res, 404, { error: 'Not found' });
    }
    const entity = await KoadHarnessEntityLoader.getEntity(
      handle, this.config.entityBaseDir, this.config.cacheTTL || 300000
    );
    if (!entity || !entity.avatarPath) {
      return this.json(res, 404, { error: 'Not found' });
    }
    const stat = fs.statSync(entity.avatarPath);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(entity.avatarPath).pipe(res);
  }

  async handleChat(req, res) {
    let body;
    try {
      body = await this.readBody(req);
    } catch (err) {
      return this.json(res, 400, { error: err.message });
    }

    const { entity: entityHandle, message, sessionId, ddpToken } = body;

    // DDP gate: require a valid token issued via Meteor method (proves DDP session)
    if (!KoadHarnessDdpGate.validateToken(ddpToken)) {
      this.log(`chat blocked: no valid DDP token ip=${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
      return this.json(res, 403, { error: 'there is nothing here for you' });
    }

    if (!entityHandle || !this.config.entities.includes(entityHandle)) {
      return this.json(res, 400, { error: 'Unknown entity' });
    }

    let entity;
    try {
      entity = await KoadHarnessEntityLoader.getEntity(
        entityHandle, this.config.entityBaseDir, this.config.cacheTTL || 300000
      );
    } catch (err) {
      return this.json(res, 500, { error: 'Failed to load entity' });
    }

    const fallback = (key) => {
      if (entity.fallbacks && entity.fallbacks[key]) return entity.fallbacks[key];
      return 'I am unable to respond at this moment. Please try again.';
    };

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    this.log(`chat: entity=${entityHandle} session=${sessionId || 'new'} ip=${ip}`);

    // Session
    let session;
    if (sessionId && this.sessions.sessions.has(sessionId)) {
      session = this.sessions.getSession(sessionId);
    } else {
      session = this.sessions.createSession(entityHandle, ip);
    }

    // Rate limit
    const rateCheck = this.rateLimiter.check(session.id, ip);
    if (!rateCheck.allowed) {
      this.log(`rate limited: session=${session.id} ip=${ip}`);
      KoadHarnessSSE.writeHeaders(res);
      KoadHarnessSSE.writeEvent(res, 'error', { message: rateCheck.reason, fallback: fallback('rate_limit') });
      return KoadHarnessSSE.endStream(res);
    }

    this.rateLimiter.record(session.id, ip);

    // Budget checks (token + cost)
    const sessionCfg = this.config.session || {};
    const sessionUsage = this.sessions.getUsage(session.id);
    if (sessionUsage) {
      const tokenBudget = sessionCfg.tokenBudget || 0;
      if (tokenBudget > 0 && sessionUsage.total_tokens >= tokenBudget) {
        this.log(`token budget exceeded: session=${session.id} used=${sessionUsage.total_tokens} budget=${tokenBudget}`);
        KoadHarnessSSE.writeHeaders(res);
        KoadHarnessSSE.writeEvent(res, 'error', { message: 'session_budget_exceeded', fallback: fallback('rate_limit') });
        return KoadHarnessSSE.endStream(res);
      }
      const costBudget = sessionCfg.costBudget || 0;
      if (costBudget > 0 && sessionUsage.cost_usd >= costBudget) {
        this.log(`cost budget exceeded: session=${session.id} spent=$${sessionUsage.cost_usd.toFixed(4)} budget=$${costBudget}`);
        KoadHarnessSSE.writeHeaders(res);
        KoadHarnessSSE.writeEvent(res, 'error', { message: 'session_budget_exceeded', fallback: fallback('rate_limit') });
        return KoadHarnessSSE.endStream(res);
      }
    }

    // Provider health — if down, check if retry window has passed
    if (this.providerDown) {
      if (Date.now() - this.providerDownSince < this.providerDownRetryAfter) {
        this.log(`provider down: session=${session.id} since=${new Date(this.providerDownSince).toISOString()}`);
        KoadHarnessSSE.writeHeaders(res);
        KoadHarnessSSE.writeEvent(res, 'error', { message: 'provider_unavailable', fallback: fallback('default') });
        return KoadHarnessSSE.endStream(res);
      }
      this.log('provider retry window reached, attempting recovery');
      this.providerDown = false;
    }

    // Input filter
    const inputCheck = KoadHarnessInputFilter.filter(message, this.config.inputFilter || {});
    if (!inputCheck.allowed) {
      this.log(`input blocked: session=${session.id} reason=${inputCheck.reason}`);
      KoadHarnessSSE.writeHeaders(res);
      KoadHarnessSSE.writeEvent(res, 'error', { message: inputCheck.reason, fallback: fallback('injection_detected') });
      return KoadHarnessSSE.endStream(res);
    }
    const cleanMessage = inputCheck.message;

    // Build prompts
    const systemPrompt = KoadHarnessPrompt.buildSystemPrompt(entity, this.config.contextLayers);
    const history = this.sessions.getHistory(session.id);
    const prompt = KoadHarnessPrompt.buildPrompt(history, cleanMessage);

    this.sessions.addMessage(session.id, 'user', cleanMessage);

    // Start SSE
    KoadHarnessSSE.writeHeaders(res);
    KoadHarnessSSE.writeEvent(res, 'session', { sessionId: session.id });

    // Provider
    const providerName = this.config.provider.default;
    const provider = KoadHarnessProviders.get(providerName);
    const providerOpts = this.config.provider[providerName] || {};

    let fullText = '';

    const cancel = provider.stream(
      systemPrompt,
      prompt,
      (chunk) => {
        fullText += chunk;
        if (fullText.length % 200 < chunk.length) {
          const outputCheck = KoadHarnessOutputFilter.scan(fullText, entity);
          if (!outputCheck.clean) {
            KoadHarnessSSE.writeEvent(res, 'error', { message: outputCheck.reason, fallback: fallback('default') });
            KoadHarnessSSE.endStream(res);
            this.rateLimiter.release();
            if (cancel) cancel();
            return;
          }
        }
        KoadHarnessSSE.writeEvent(res, 'chunk', { text: chunk });
      },
      (finalText, providerUsage) => {
        const outputCheck = KoadHarnessOutputFilter.scan(finalText, entity);
        if (!outputCheck.clean) {
          this.log(`output blocked: session=${session.id} reason=${outputCheck.reason}`);
          KoadHarnessSSE.writeEvent(res, 'error', { message: outputCheck.reason, fallback: fallback('default') });
        } else {
          // Record and accumulate usage with provider rates
          if (providerUsage) {
            const rates = (this.config.provider[providerName] && this.config.provider[providerName].rates) || {};
            providerUsage._rates = { input: rates.input || 3.0, output: rates.output || 15.0 };
            this.sessions.recordUsage(session.id, providerUsage);
          }
          const sessionUsage = this.sessions.getUsage(session.id);
          const donePayload = { fullText: finalText };
          if (providerUsage) {
            donePayload.usage = providerUsage;
          }
          if (sessionUsage) {
            donePayload.sessionUsage = sessionUsage;
          }
          if (providerUsage) {
            this.log(`usage: session=${session.id} req=[p:${providerUsage.prompt_tokens} c:${providerUsage.completion_tokens}] total=[p:${sessionUsage.prompt_tokens} c:${sessionUsage.completion_tokens} t:${sessionUsage.total_tokens} r:${sessionUsage.requests}]`);
          }
          KoadHarnessSSE.writeEvent(res, 'done', donePayload);
          this.sessions.addMessage(session.id, 'entity', finalText);
        }
        KoadHarnessSSE.endStream(res);
        this.rateLimiter.release();
      },
      (err) => {
        this.logErr(`inference error: session=${session.id} error=${err.message}`);
        // Detect payment/quota exhaustion — mark provider down so we fail fast
        const msg = err.message || '';
        if (msg.includes('402') || msg.includes('429') || msg.includes('quota') || msg.includes('insufficient')) {
          this.providerDown = true;
          this.providerDownSince = Date.now();
          this.logErr(`provider marked DOWN — credit/quota exhausted. Will retry after ${this.providerDownRetryAfter / 1000}s`);
          KoadHarnessSSE.writeEvent(res, 'error', { message: 'provider_unavailable', fallback: fallback('default') });
        } else {
          KoadHarnessSSE.writeEvent(res, 'error', { message: 'inference_error', fallback: fallback('default') });
        }
        KoadHarnessSSE.endStream(res);
        this.rateLimiter.release();
      },
      providerOpts
    );

    req.on('close', () => {
      if (cancel) cancel();
      this.rateLimiter.release();
    });
  }

  // --- Request dispatch ---

  async handle(req, res) {
    this.setCors(res, req);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const { path, segments, query } = this.routePath(req.url);

    try {
      if (req.method === 'GET' && path === '/health') {
        return this.handleHealth(req, res);
      }
      if (req.method === 'GET' && path === '/entities') {
        return await this.handleEntities(req, res, query);
      }
      if (req.method === 'GET' && segments[0] === 'entities' && segments.length === 2) {
        return await this.handleEntitySingle(req, res, segments[1], query);
      }
      if (req.method === 'GET' && segments[0] === 'entities' && segments[2] === 'avatar') {
        return await this.handleAvatar(req, res, segments[1]);
      }
      if (req.method === 'POST' && path === '/chat') {
        return await this.handleChat(req, res);
      }
      this.json(res, 404, { error: 'Not found' });
    } catch (err) {
      this.logErr(`unhandled error: ${err.message}`);
      this.json(res, 500, { error: 'Internal server error' });
    }
  }
}

// --- Mount on Meteor's WebApp ---

KoadHarness = {
  instances: [],

  init() {
    const settings = Meteor.settings && Meteor.settings.harnesses;
    if (!settings || !Array.isArray(settings) || settings.length === 0) {
      console.log('[harness] No harnesses configured in Meteor.settings.harnesses — skipping');
      return;
    }

    for (const config of settings) {
      const instance = new HarnessInstance(config);
      this.instances.push(instance);
      console.log(`[harness] Registered: ${instance.prefix} → entities: [${config.entities.join(', ')}] provider: ${config.provider.default}`);
      // juno#90: install per-host OG/oembed meta-tag injector if configured.
      if (typeof KoadHarnessOgInjector !== 'undefined') {
        KoadHarnessOgInjector.install(instance);
      }
    }

    // Use rawConnectHandlers for SSE (bypasses Meteor's body parser)
    WebApp.rawConnectHandlers.use(Meteor.bindEnvironment((req, res, next) => {
      for (const instance of this.instances) {
        if (instance.matches(req.url)) {
          return instance.handle(req, res);
        }
      }
      next();
    }));

    // Preload entities
    Meteor.startup(() => {
      for (const instance of this.instances) {
        const config = instance.config;
        KoadHarnessEntityLoader.loadAll(
          config.entities, config.entityBaseDir, config.cacheTTL || 300000
        ).then((loaded) => {
          console.log(`[harness] ${instance.prefix} loaded: ${Object.keys(loaded).join(', ')}`);
        }).catch((err) => {
          console.error(`[harness] ${instance.prefix} failed to preload:`, err.message);
        });
      }
    });
  },
};

// Auto-initialize
KoadHarness.init();
