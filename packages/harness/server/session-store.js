class SessionStore {
  constructor(config = {}) {
    this.sessions = new Map();
    this.ttl = config.ttl || 1800000;
    this.maxMessages = config.maxMessages || 50;
    this.cleanupInterval = setInterval(() => this.cleanup(), config.cleanupInterval || 300000);
  }

  getSession(sessionId) {
    let session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      return session;
    }
    session = {
      id: sessionId,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  createSession(entity, ip) {
    const id = Random.id();
    const session = {
      id,
      entity,
      ip,
      messages: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0, cost_usd: 0 },
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  addMessage(sessionId, role, content) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages.push({ role, content, timestamp: Date.now() });
    if (session.messages.length > this.maxMessages) {
      session.messages = session.messages.slice(-this.maxMessages);
    }
    session.lastActivity = Date.now();
  }

  recordUsage(sessionId, providerUsage) {
    const session = this.sessions.get(sessionId);
    if (!session || !providerUsage) return;
    const pt = providerUsage.prompt_tokens || 0;
    const ct = providerUsage.completion_tokens || 0;
    session.usage.prompt_tokens += pt;
    session.usage.completion_tokens += ct;
    session.usage.total_tokens += pt + ct;
    session.usage.requests += 1;
    // Calculate cost from token counts using provider rates (per-million pricing)
    const rates = providerUsage._rates || { input: 3.0, output: 15.0 }; // defaults: Grok-3
    session.usage.cost_usd += (pt * rates.input / 1_000_000) + (ct * rates.output / 1_000_000);
  }

  getUsage(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.usage : null;
  }

  getHistory(sessionId, limit = 20) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }

  get count() {
    return this.sessions.size;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.ttl) {
        this.sessions.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }
}

KoadHarnessSessionStore = SessionStore;
