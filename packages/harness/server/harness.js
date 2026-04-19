const fs = require('fs');

/*
 * koad:harness — Entity conversation harness for Meteor
 *
 * Configure via Meteor.settings.harnesses (array of harness configs):
 *
 *   {
 *     "harnesses": [
 *       {
 *         "path": "/harness",
 *         "entities": ["alice", "juno", "vulcan", "..."],
 *         "entityBaseDir": "/home/koad",
 *         "cacheTTL": 300000,
 *         "access": { ...tier-based rules for all users... },
 *         "providers": { "grok": { "rates": { "input": 0.30, "output": 1.50 } } },
 *         "session": { "ttl": 1800000, "maxMessages": 50 },
 *         "rateLimits": { "enabled": false },
 *         "inputFilter": { "maxLength": 2000 }
 *       },
 *       {
 *         "path": "/harness/koad-self",
 *         "entities": "*",
 *         "allowed_users": ["koad"],
 *         "provider": "claude-code",
 *         "tools": ["Read", "Glob", "Grep"]
 *       }
 *     ]
 *   }
 *
 * allowed_users: if present on a harness config, only the listed usernames may
 * use this harness. Any request from a user not in the list receives a silent
 * 404 — the harness's existence is not disclosed.
 *
 * Each harness mounts at its own path prefix and serves its own set of entities.
 * Routes per harness:
 *   GET  {path}/health
 *   GET  {path}/entities
 *   GET  {path}/entities/:handle
 *   GET  {path}/entities/:handle/avatar
 *   POST {path}/chat
 */

// ── allowed_users namespace-prefix parser (SPEC-128 v1.6 §6) ─────────────────
// Entries must use "username:<name>" or "user:<id>" form.
// Unprefixed entries are rejected at config-parse time with an explicit error.
// Returns { valid: Boolean, error?: String } for a single entry,
// or use _parseAllowedUsers() to validate an entire list.
//
// Comparison semantics:
//   "username:<name>" — compare against user.services.github.login; case-insensitive
//   "user:<id>"       — compare against users._id; exact string match
function _parseAllowedUserEntry(entry) {
  if (typeof entry !== 'string') {
    return { valid: false, error: `allowed_users entry must be a string, got ${typeof entry}: ${JSON.stringify(entry)}` };
  }
  if (entry.startsWith('username:')) {
    return { valid: true, kind: 'username', value: entry.slice('username:'.length) };
  }
  if (entry.startsWith('user:')) {
    return { valid: true, kind: 'user_id', value: entry.slice('user:'.length) };
  }
  return { valid: false, error: `allowed_users entry "${entry}" lacks namespace prefix — must be "username:<name>" or "user:<id>"` };
}

function _validateAllowedUsers(list) {
  for (const entry of list) {
    const parsed = _parseAllowedUserEntry(entry);
    if (!parsed.valid) {
      throw new Error(`[harness] config error: ${parsed.error}`);
    }
  }
}

// Check whether a resolved user (from a DDP-token lookup) matches any entry.
// userDoc must have { _id, services: { github: { login } } }.
function _userMatchesAllowedList(userDoc, allowedUsers) {
  if (!userDoc) return false;
  for (const entry of allowedUsers) {
    const parsed = _parseAllowedUserEntry(entry);
    if (!parsed.valid) continue; // already validated at init; skip silently here
    if (parsed.kind === 'username') {
      const login = userDoc.services && userDoc.services.github && userDoc.services.github.login;
      if (login && login.toLowerCase() === parsed.value.toLowerCase()) return true;
    } else if (parsed.kind === 'user_id') {
      if (userDoc._id === parsed.value) return true;
    }
  }
  return false;
}

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
    // Validate allowed_users entries at construction time (SPEC-128 v1.6 §6)
    if (config.allowed_users && Array.isArray(config.allowed_users) && config.allowed_users.length > 0) {
      _validateAllowedUsers(config.allowed_users); // throws on invalid — fail fast at boot
    }
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
    // Support both legacy provider.default and new providers config shapes
    const providerDefault = (this.config.provider && this.config.provider.default)
                            || (this.config.providers ? Object.keys(this.config.providers)[0] : 'unknown');
    this.json(res, 200, {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      sessions: this.sessions.count,
      entities: this.config.entities,
      provider: providerDefault,
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

    // Resolve sponsor userId from the DDP token (null for anonymous sessions)
    const sponsorUserId = KoadHarnessDdpGate.getTokenUserId(ddpToken);

    // DDP gate: require a valid token issued via Meteor method (proves DDP session)
    if (!KoadHarnessDdpGate.validateToken(ddpToken)) {
      this.log(`chat blocked: no valid DDP token ip=${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
      return this.json(res, 403, { error: 'there is nothing here for you' });
    }

    // allowed_users gate: special harnesses (e.g. koad-only self-auth) restrict
    // access to a namespace-prefixed list of users. Any other user gets a silent 404 —
    // we do not disclose the harness's existence.
    // Entry forms: "username:<github-login>" or "user:<meteor-_id>" (SPEC-128 v1.6 §6)
    const allowedUsers = this.config.allowed_users;
    if (allowedUsers && Array.isArray(allowedUsers) && allowedUsers.length > 0) {
      let userDoc = null;
      if (sponsorUserId) {
        try {
          userDoc = await Meteor.users.findOneAsync(sponsorUserId, {
            fields: { _id: 1, services: 1 },
          });
        } catch (e) {
          // Non-blocking — if lookup fails, treat as unauthorized
        }
      }
      if (!_userMatchesAllowedList(userDoc, allowedUsers)) {
        // Silent 404: do not reveal the harness exists
        return this.json(res, 404, { error: 'Not found' });
      }
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

    // Budget checks (token + cost) — legacy session-level budgets
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

    // ── VESTA-SPEC-133 Access Gate Stack ──────────────────────────────────────
    // Resolve which provider to use via tier + XP + headroom gates.
    // Falls back silently; sponsor sees no gate errors (SPEC-133 §6.3).
    // If no access config is present, falls through to legacy provider.default.

    let providerName = this.config.provider && this.config.provider.default;
    let _accessFallbackReason = null;

    if (typeof KoadHarnessAccessGate !== 'undefined' && this.config.access) {
      let insidersState = null;
      if (sponsorUserId) {
        try {
          const userDoc = await Meteor.users.findOneAsync(sponsorUserId, { fields: { insidersState: 1 } });
          insidersState = userDoc && userDoc.insidersState;
        } catch (e) {
          // Non-blocking — if we can't read state, gate will fall back
        }
      }

      const gateResult = await KoadHarnessAccessGate.resolveProvider(
        this.config.access,
        sponsorUserId,
        insidersState,
        this.config.providers
      );

      if (gateResult.provider) {
        providerName = gateResult.provider;
        _accessFallbackReason = gateResult.fallbackReason;
      }
    }
    // ── End Gate Stack ─────────────────────────────────────────────────────────

    const provider = KoadHarnessProviders.get(providerName);
    // Provider options: from providers.<name> block (SPEC-133 config shape)
    // or legacy provider.<name> block
    const providerOpts = (this.config.providers && this.config.providers[providerName])
                         || (this.config.provider && this.config.provider[providerName])
                         || {};

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
        // Extract <<CAPTURE_FEEDBACK>> markers before output checks or client delivery.
        // VESTA-SPEC-132 §3.1.5: markers are always stripped; valid ones fire the
        // registered callback (fire-and-forget — does not block response delivery).
        const sessionHistory = this.sessions.getHistory(session.id, 10).map(m => ({
          role: m.role,
          content: m.content,
          at: new Date(m.timestamp || Date.now()),
        }));
        const cleanedText = KoadHarnessFeedbackExtractor.extract(finalText, {
          entity: entityHandle,
          sessionId: session.id,
          userId: sponsorUserId,
          sessionHistory,
        });

        const outputCheck = KoadHarnessOutputFilter.scan(cleanedText, entity);
        if (!outputCheck.clean) {
          this.log(`output blocked: session=${session.id} reason=${outputCheck.reason}`);
          KoadHarnessSSE.writeEvent(res, 'error', { message: outputCheck.reason, fallback: fallback('default') });
        } else {
          // Record and accumulate usage with provider rates
          // SPEC-133: check providers.<name>.rates (new config shape) then legacy provider.<name>.rates
          if (providerUsage) {
            const rates = (this.config.providers && this.config.providers[providerName] && this.config.providers[providerName].rates)
                          || (this.config.provider && this.config.provider[providerName] && this.config.provider[providerName].rates)
                          || {};
            providerUsage._rates = { input: rates.input || 3.0, output: rates.output || 15.0 };
            this.sessions.recordUsage(session.id, providerUsage);
          }

          // ── SPEC-133 Quota Debit (pre-debit markup) ──────────────────────────
          // Debit actual provider cost × markup against sponsor's quota window or gas tank.
          // Fire-and-forget: quota failure after response delivery is logged, not shown.
          if (providerUsage && sponsorUserId && this.config.access && typeof KoadHarnessAccessGate !== 'undefined') {
            Meteor.defer(async () => {
              try {
                const tierSlug = (() => {
                  const ud = Meteor.users.findOne(sponsorUserId, { fields: { insidersState: 1 } });
                  return ud && ud.insidersState && ud.insidersState.current_tier;
                })();
                const tierCfg  = this.config.access && this.config.access.tiers && this.config.access.tiers[tierSlug];
                if (!tierCfg) return;

                const markup    = KoadHarnessAccessGate.getMarkup(tierCfg);
                const rates     = providerUsage._rates || {};
                const provCost  = ((providerUsage.prompt_tokens || 0) * (rates.input || 3.0)
                                   + (providerUsage.completion_tokens || 0) * (rates.output || 15.0)) / 1_000_000;
                const debitCost = provCost * markup;

                if (tierCfg.monthly_gas_tank_usd != null && globalThis.GasTankStateCollection) {
                  // Gas tank debit
                  await globalThis.GasTankStateCollection.updateAsync(sponsorUserId, {
                    $inc: { monthly_spent_usd: debitCost, window_spent_usd: debitCost },
                  });

                  // Fire observability events (SPEC-133 §10)
                  if (globalThis.InsidersLedger) {
                    const gasDoc = await globalThis.GasTankStateCollection.findOneAsync(sponsorUserId);
                    if (gasDoc) {
                      const remaining = (gasDoc.monthly_gas_tank_usd || 0) - (gasDoc.monthly_spent_usd || 0);
                      if (remaining <= 0) {
                        globalThis.InsidersLedger.recordEvent(sponsorUserId, {
                          event_type: 'quota.exhausted', occurred_at: new Date(), source: 'internal',
                          payload: { quota_model: 'monthly_gas_tank', tier: tierSlug, surface: 'chat' },
                        }).catch(() => {});
                      }
                      if (providerName === 'claude-code' && (gasDoc.monthly_spent_usd || 0) > (gasDoc.monthly_gas_tank_usd || 0)) {
                        globalThis.InsidersLedger.recordEvent(sponsorUserId, {
                          event_type: 'overage.triggered', occurred_at: new Date(), source: 'internal',
                          payload: { tier: tierSlug, surface: 'chat', overage_usd: provCost },
                        }).catch(() => {});
                      }
                    }
                  }

                } else if (tierCfg.budget_usd != null && globalThis.QuotaWindowsCollection) {
                  // Windowed budget debit
                  const docId = `${tierSlug}:${sponsorUserId}`;
                  await globalThis.QuotaWindowsCollection.updateAsync(docId, {
                    $inc: { spent_usd: debitCost, request_count: 1 },
                  });

                  if (globalThis.InsidersLedger) {
                    const wDoc = await globalThis.QuotaWindowsCollection.findOneAsync(docId);
                    if (wDoc && (wDoc.spent_usd || 0) >= (tierCfg.budget_usd || 0)) {
                      globalThis.InsidersLedger.recordEvent(sponsorUserId, {
                        event_type: 'quota.exhausted', occurred_at: new Date(), source: 'internal',
                        payload: { quota_model: 'windowed_budget', tier: tierSlug, surface: 'chat' },
                      }).catch(() => {});
                    }
                  }
                }
              } catch (err) {
                console.warn(`[harness:quota] debit error for user=${sponsorUserId}:`, err.message);
              }
            });
          }
          // ── End Quota Debit ───────────────────────────────────────────────────
          const sessionUsage = this.sessions.getUsage(session.id);
          // Use cleanedText (markers stripped) as the canonical response
          const donePayload = { fullText: cleanedText };
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
          // Store cleaned text in history so CAPTURE_FEEDBACK markers never appear
          // in subsequent context passed back to the provider
          this.sessions.addMessage(session.id, 'entity', cleanedText);
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

  // --- allowed_users check for GET routes ---
  // Returns true if the request is allowed to proceed for this harness.
  // Uses namespace-prefix parser per SPEC-128 v1.6 §6:
  //   "username:<github-login>" — case-insensitive match against services.github.login
  //   "user:<meteor-_id>"      — exact match against users._id
  async _checkAllowedUsers(req) {
    const allowedUsers = this.config.allowed_users;
    if (!allowedUsers || !Array.isArray(allowedUsers) || allowedUsers.length === 0) {
      return true; // no restriction
    }
    // Extract DDP token from Authorization header (Bearer)
    let ddpToken = null;
    const auth = req.headers && req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      ddpToken = auth.slice(7).trim();
    }
    if (!ddpToken) {
      // No token — deny silently
      return false;
    }
    const sponsorUserId = KoadHarnessDdpGate.getTokenUserId(ddpToken);
    if (!sponsorUserId) return false;
    try {
      const userDoc = await Meteor.users.findOneAsync(sponsorUserId, {
        fields: { _id: 1, services: 1 },
      });
      return _userMatchesAllowedList(userDoc, allowedUsers);
    } catch (e) {
      return false;
    }
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
        // Health endpoint is not gated by allowed_users (used by monitoring)
        return this.handleHealth(req, res);
      }
      if (req.method === 'GET' && path === '/entities') {
        if (!(await this._checkAllowedUsers(req))) return this.json(res, 404, { error: 'Not found' });
        return await this.handleEntities(req, res, query);
      }
      if (req.method === 'GET' && segments[0] === 'entities' && segments.length === 2) {
        if (!(await this._checkAllowedUsers(req))) return this.json(res, 404, { error: 'Not found' });
        return await this.handleEntitySingle(req, res, segments[1], query);
      }
      if (req.method === 'GET' && segments[0] === 'entities' && segments[2] === 'avatar') {
        if (!(await this._checkAllowedUsers(req))) return this.json(res, 404, { error: 'Not found' });
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
      const providerLabel = (config.provider && config.provider.default)
                             || (config.providers ? Object.keys(config.providers)[0] : 'configured');
      console.log(`[harness] Registered: ${instance.prefix} → entities: [${config.entities.join(', ')}] provider: ${providerLabel}`);
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
