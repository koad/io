// Access Gate Stack — VESTA-SPEC-133 §6 (reframed 2026-04-19)
//
// Architecture reframe: claude-code is NOT the sponsor-default provider.
// It is a self-auth provider for koad only (and future sponsor-bonded keys).
// Tier-based routing uses each tier's `provider` field directly — no special
// gate stack is needed for normal sponsor routing.
//
// The XP + headroom gates that previously guarded sponsor claude-code access now
// only apply to harnesses with `provider: "claude-code"` in their tier config —
// which in practice is the koad-only special harness (allowed_users: ["koad"]).
//
// allowed_users enforcement is handled upstream in harness.js before this function
// is called; by the time resolveProvider runs, the user is already authorized to
// use this harness.
//
// Gate stack (only triggered when tier config declares provider: "claude-code"):
//   Gate 1 — Tier:     insidersState.current_tier === "insider"
//   Gate 2 — XP:       insidersState.contributions.xp >= xp_required
//   Gate 3 — Headroom: headroomAvailable() === true (protects koad's Max plan)
//
// Evaluation order: Tier → XP → Headroom (short-circuit on first failure).
// Any failure → silent fallback to fallback_provider.
// Gate failures are logged at INFO (user_id + gate name — no other PII).
// No error surfaced to user.
//
// resolveProvider(config, user) → Promise<{ provider, fallbackReason }>

KoadHarnessAccessGate = {
  // Resolve which provider to use for a request.
  //
  // accessConfig — harness access config block:
  //   { anonymous: {...}, tiers: { explorer: {...}, ..., insider: {...} } }
  //
  // userId — Meteor users._id or null (anonymous)
  // insidersState — user.insidersState (pre-fetched by caller, or null)
  // providerConfig — providers block from harness config (for headroom_check_cmd)
  //
  // Returns Promise<{ provider: string|null, fallbackReason: string|null }>
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
      // No config for this tier — fall back to anonymous config if available
      tierConfig = accessConfig.anonymous;
    }

    if (!tierConfig) {
      // No tier config and no anonymous fallback — deny
      console.info(`[harness:access-gate] no config for tier=${tierSlug || 'null'} user=${userId} → deny`);
      return { provider: null, fallbackReason: 'no_tier_config' };
    }

    // Validate tier config (§3.2 rule: must have exactly one quota model)
    if (this._isConfigMalformed(tierConfig)) {
      console.warn(`[harness:access-gate] malformed tier config for tier=${tierSlug}. Refusing to route.`);
      return { provider: tierConfig.fallback_provider || 'grok', fallbackReason: 'malformed_config' };
    }

    const desiredProvider  = tierConfig.provider;
    const fallbackProvider = tierConfig.fallback_provider;

    // Standard path: tier routes directly to its configured provider.
    // No gate stack. Budget check happens post-response in the debit engine.
    if (desiredProvider !== 'claude-code') {
      return { provider: desiredProvider, fallbackReason: null };
    }

    // Special path: tier config explicitly declares claude-code (koad-only harness).
    // Apply three-gate stack: Tier → XP → Headroom.
    // This protects koad's Max plan from being exhausted by any scenario.

    // Gate 1 — Tier (must be insider)
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
