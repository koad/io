class RateLimiter {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.perSession = config.perSession || { max: 6, windowMs: 60000 };
    this.perIp = config.perIp || { maxSessions: 5, windowMs: 3600000 };
    this.globalConcurrent = config.globalConcurrent || 10;

    this.sessionHits = new Map();
    this.ipSessions = new Map();
    this.activeConcurrent = 0;
  }

  check(sessionId, ip) {
    if (!this.enabled) return { allowed: true };

    if (this.activeConcurrent >= this.globalConcurrent) {
      return { allowed: false, reason: 'rate_limit', detail: 'Too many active conversations' };
    }

    const now = Date.now();
    const sessionTimes = this.sessionHits.get(sessionId) || [];
    const recentSession = sessionTimes.filter(t => now - t < this.perSession.windowMs);
    if (recentSession.length >= this.perSession.max) {
      return { allowed: false, reason: 'rate_limit', detail: 'Please slow down' };
    }

    const ipTimes = this.ipSessions.get(ip) || [];
    const recentIp = ipTimes.filter(t => now - t < this.perIp.windowMs);
    if (recentIp.length >= this.perIp.maxSessions) {
      return { allowed: false, reason: 'rate_limit', detail: 'Too many sessions from this address' };
    }

    return { allowed: true };
  }

  record(sessionId, ip) {
    if (!this.enabled) return;

    const now = Date.now();
    const sessionTimes = this.sessionHits.get(sessionId) || [];
    sessionTimes.push(now);
    this.sessionHits.set(sessionId, sessionTimes);

    const ipTimes = this.ipSessions.get(ip) || [];
    ipTimes.push(now);
    this.ipSessions.set(ip, ipTimes);

    this.activeConcurrent++;
  }

  release() {
    this.activeConcurrent = Math.max(0, this.activeConcurrent - 1);
  }
}

KoadHarnessRateLimiter = RateLimiter;
