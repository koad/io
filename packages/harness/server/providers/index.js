const providers = {
  mock:         KoadHarnessProviderMock,
  ollama:       KoadHarnessProviderOllama,
  anthropic:    KoadHarnessProviderAnthropic,
  groq:         KoadHarnessProviderGroq,
  xai:          KoadHarnessProviderXai,
  'claude-code': KoadHarnessProviderClaudeCode,
  // grok is an alias for xai (SPEC-133 horizon doc uses 'grok' as the handle)
  grok:         KoadHarnessProviderXai,
};

KoadHarnessProviders = {
  get(name) {
    const provider = providers[name];
    if (!provider) throw new Error(`[harness] Unknown provider: ${name}`);
    return provider;
  },
};
