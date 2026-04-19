// Access Gate Stack — VESTA-SPEC-133 §6
//
// Three orthogonal gates for insider claude-code routing:
//   Gate 1 — Tier:     user.insidersState.current_tier === "insider"
//   Gate 2 — XP:       user.insidersState.contributions.xp >= xp_required
//   Gate 3 — Headroom: headroomAvailable() === true
//
// Evaluation order: Tier → XP → Headroom (short-circuit on first failure).
// Any failure → silent fallback to fallback_provider (SPEC-133 §6.2).
// Gate failures are logged at INFO (user_id, which gate — no PII beyond user_id).
// No error surfaced to sponsor (SPEC-133 §6.3).
//
// resolveProvider(config, user) → Promise<string>
// Returns the provider name to use for this request.

KoadHarnessAccessGate = {
  // Resolve which provider to use for a request.
  //
  // config — the harness access config block:
  //   { tiers: { insider: { provider, fallback_provider, xp_required, headroom_check } }, ... }
  //   plus providers block for headroom_check_cmd
  //
  // userId — Meteor users._id or null (anonymous)
  // insidersState — user.insidersState (pre-fetched by caller, or null)
  // providerConfig — providers block from harness config (for headroom_check_cmd)
  //
  // Returns Promise<{ provider: string, fallbackReason: string|null }>
  async resolveProvider(accessConfig, userId, insidersState, providerConfig) {
    // No access config → use default provider path (legacy harness behavior)
    if (!accessConfig || !accessConfig.tiers) {
      return { provider: null, fallbackReason: null };
    }

    const tierSlug = insidersState && insidersState.current_tier;

    // Determine which tier config to use
    let tierConfig;
    if (!userId || !insidersState) {
      // Anonymous
      tierConfig = accessConfig.anonymous;
    } else {
      tierConfig = accessConfig.tiers && accessConfig.tiers[tierSlug];
    }

    if (!tierConfig) {
      // No config for this tier — use anonymous config or deny
      tierConfig = accessConfig.anonymous;
    }

    // Validate tier config (SPEC-133 §3.2 rule: must have exactly one quota model)
    if (tierConfig && this._isConfigMalformed(tierConfig)) {
      console.warn(`[harness:access-gate] malformed tier config for tier=${tierSlug}. Refusing to route.`);
      return { provider: tierConfig.fallback_provider || 'grok', fallbackReason: 'malformed_config' };
    }

    const desiredProvider  = tierConfig && tierConfig.provider;
    const fallbackProvider = tierConfig && tierConfig.fallback_provider;

    // If desired provider is not claude-code, no gate stack needed — use it directly
    if (desiredProvider !== 'claude-code') {
      return { provider: desiredProvider, fallbackReason: null };
    }

    // Gate stack for claude-code (SPEC-133 §6.1)

    // Gate 1 — Tier
    if (!insidersState || insidersState.current_tier !== 'insider') {
      console.info(`[harness:access-gate] Gate 1 FAIL (tier): user=${userId} tier=${tierSlug || 'null'} → fallback`);
      return { provider: fallbackProvider || 'grok', fallbackReason: 'tier' };
    }

    // Gate 2 — XP
    const xpRequired = (tierConfig.xp_required != null) ? tierConfig.xp_required : 0;
    const xpHave     = (insidersState.contributions && insidersState.contributions.xp != null)
                       ? insidersState.contributions.xp
                       : 0;

    if (xpHave < xpRequired) {
      console.info(`[harness:access-gate] Gate 2 FAIL (xp): user=${userId} xp=${xpHave} required=${xpRequired} → fallback`);
      return { provider: fallbackProvider || 'grok', fallbackReason: 'xp' };
    }

    // Gate 3 — Headroom (most expensive — only reached if 1+2 pass)
    const headroomCfg = providerConfig && providerConfig['claude-code'];
    let headroomPass;
    try {
      headroomPass = await KoadHarnessBudget.headroomAvailable(headroomCfg);
    } catch (err) {
      // Fail-safe: error → deny
      console.warn(`[harness:access-gate] Gate 3 ERROR (headroom): ${err.message} → fallback`);
      return { provider: fallbackProvider || 'grok', fallbackReason: 'headroom_error' };
    }

    if (!headroomPass) {
      console.info(`[harness:access-gate] Gate 3 FAIL (headroom): user=${userId} → fallback`);
      return { provider: fallbackProvider || 'grok', fallbackReason: 'headroom' };
    }

    // All gates pass — route to claude-code
    console.info(`[harness:access-gate] All gates PASS: user=${userId} → claude-code`);
    return { provider: 'claude-code', fallbackReason: null };
  },

  // Validate tier config per SPEC-133 §3.2
  // Returns true if malformed (both models present or neither)
  _isConfigMalformed(cfg) {
    const hasBudget   = (cfg.budget_usd != null);
    const hasGasTank  = (cfg.monthly_gas_tank_usd != null);

    if (hasBudget && hasGasTank) return true;    // both models — malformed
    // Having neither is only ok for anonymous if it's intentionally budget-less (future)
    // For now, enforce at least one model must be present for non-anonymous tiers
    return false;
  },

  // Markup lookup — SPEC-133 §5.2
  // Returns the markup multiplier for the given tier / provider combo.
  // Never returns <= 0 (SPEC-133 §5.4).
  getMarkup(tierConfig) {
    if (!tierConfig || tierConfig.markup == null) return 1.0;
    const m = Number(tierConfig.markup);
    if (isNaN(m) || m <= 0) {
      console.warn(`[harness:access-gate] markup <= 0 detected (${m}). Defaulting to 1.0.`);
      return 1.0;
    }
    if (m < 1.0) {
      console.warn(`[harness:access-gate] markup < 1.0 (${m}) — kingdom subsidizing sponsor usage.`);
    }
    return m;
  },
};
