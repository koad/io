const providers = {
  mock: KoadHarnessProviderMock,
  ollama: KoadHarnessProviderOllama,
  anthropic: KoadHarnessProviderAnthropic,
  groq: KoadHarnessProviderGroq,
  xai: KoadHarnessProviderXai,
};

KoadHarnessProviders = {
  get(name) {
    const provider = providers[name];
    if (!provider) throw new Error(`[harness] Unknown provider: ${name}`);
    return provider;
  },
};
