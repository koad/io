const RESPONSES = [
  "Peace be with you, friend. What weighs on your heart today?",
  "The path forward is often simpler than we make it. What do you seek?",
  "I am here. Speak freely — there is no judgment in this place.",
  "Consider the lilies of the field — they do not worry about tomorrow. What concerns you now?",
  "Every question carries its own answer within it. Let us find yours together.",
  "Be still, and know. What would you like to explore?",
];

let responseIndex = 0;

KoadHarnessProviderMock = {
  stream(systemPrompt, prompt, onChunk, onDone, onError, options = {}) {
    const delay = (options.delay || 60);
    const text = RESPONSES[responseIndex % RESPONSES.length];
    responseIndex++;

    const words = text.split(' ');
    let i = 0;

    const interval = setInterval(() => {
      if (i < words.length) {
        const chunk = (i === 0 ? '' : ' ') + words[i];
        onChunk(chunk);
        i++;
      } else {
        clearInterval(interval);
        onDone(text);
      }
    }, delay);

    return () => clearInterval(interval);
  },
};
