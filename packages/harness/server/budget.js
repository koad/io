// Headroom gate — VESTA-SPEC-133 §7
//
// headroomAvailable(config) checks whether koad's Max 20x subscription has
// sufficient headroom to allow insider claude-code routing.
//
// config shape (from Meteor.settings providers.claude-code.headroom_check):
//   { metric: "rate_7d_projected", max: 0.80 }
//   headroom_check_cmd: "juno usage --json" (on providers.claude-code)
//
// Caching: TTL of 60s (or config.ttl_seconds). Shared across all concurrent requests.
// Fail-safe: any subprocess error → return false (protect koad's subscription).
//
// Per SPEC-133 §7.3: default max is 0.80. Missing config must still fail-safe to 0.80.

const { execFile } = require('child_process');

// Module-level cache
const _cache = {
  value:   null,    // boolean result
  fetchedAt: 0,     // Date.now() when last fetched
  ttlMs:   60000,   // 60 seconds default
};

// Override TTL for testing
KoadHarnessBudget = {
  // Check if headroom is available per SPEC-133 §7.
  // Returns a Promise<boolean>.
  // config: from providers['claude-code'] in harness config
  headroomAvailable(config) {
    const max       = (config && config.headroom_check && config.headroom_check.max) != null
                      ? config.headroom_check.max
                      : 0.80;   // SPEC-133 §7.1: default 0.80, never pass-through
    const cmd       = (config && config.headroom_check_cmd) || 'juno usage --json';
    const ttlMs     = (config && config.headroom_check_ttl_seconds)
                      ? config.headroom_check_ttl_seconds * 1000
                      : _cache.ttlMs;

    const now = Date.now();
    if (_cache.value !== null && (now - _cache.fetchedAt) < ttlMs) {
      // Cache hit
      return Promise.resolve(_cache.value);
    }

    // Cache miss — execute subprocess
    return new Promise((resolve) => {
      const parts = cmd.split(/\s+/);
      const bin   = parts[0];
      const args  = parts.slice(1);

      execFile(bin, args, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          // SPEC-133 §7.3 fail-safe: subprocess failure → deny
          console.warn(`[harness:budget] headroom check failed (${cmd}): ${err.message}. Failing safe (deny).`);
          _cache.value     = false;
          _cache.fetchedAt = Date.now();
          return resolve(false);
        }

        let projected;
        try {
          const parsed = JSON.parse(stdout);
          projected = parsed.rate_7d_projected;
        } catch (parseErr) {
          console.warn(`[harness:budget] headroom check returned malformed JSON. Failing safe (deny).`);
          _cache.value     = false;
          _cache.fetchedAt = Date.now();
          return resolve(false);
        }

        if (typeof projected !== 'number') {
          console.warn(`[harness:budget] rate_7d_projected missing from usage JSON. Failing safe (deny).`);
          _cache.value     = false;
          _cache.fetchedAt = Date.now();
          return resolve(false);
        }

        // SPEC-133 §7.2: values > 1.0 indicate overage — gate must fail
        const allowed = projected < max;
        console.log(`[harness:budget] headroom check: rate_7d_projected=${projected} max=${max} → ${allowed ? 'PASS' : 'DENY'}`);

        _cache.value     = allowed;
        _cache.fetchedAt = Date.now();
        resolve(allowed);
      });
    });
  },

  // Invalidate cache (for testing / manual refresh)
  invalidateCache() {
    _cache.value     = null;
    _cache.fetchedAt = 0;
  },

  // Expose cache for testing
  _cache,
};
