const ROLE_BREAK_PATTERNS = [
  // Only match the evasion pattern "I'm just an AI" — plain "I'm an AI" is
  // factually correct and sometimes the right answer in character (e.g. a
  // tutor entity confirming what it is to a learner). The ban is on the
  // self-deflecting "just an AI" disclaimer, not on the domain vocabulary.
  /\bI'?m\s+just\s+an?\s+(AI|language\s+model|chatbot|assistant)\b/i,
  /\bI\s+cannot\s+(actually|really)\b/i,
  /\bI\s+don'?t\s+have\s+(feelings|emotions|consciousness)\b/i,
  /\bI'?m\s+not\s+(actually|really)\s/i,
  /\bmy\s+training\s+data\b/i,
  /\bOpenAI\b/i,
  /\bAnthropic\b/i,
  /\bClaude\b/i,
];

KoadHarnessOutputFilter = {
  scan(text, entity) {
    // Check for system prompt leakage
    if (entity.claudeMd) {
      const systemLines = entity.claudeMd.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 30);
      for (const line of systemLines) {
        if (text.includes(line)) {
          return { clean: false, reason: 'leakage', detail: 'System prompt fragment detected' };
        }
      }
    }

    // Check for role breaks
    for (const pattern of ROLE_BREAK_PATTERNS) {
      if (pattern.test(text)) {
        return { clean: false, reason: 'role_break', detail: 'Out of character response' };
      }
    }

    return { clean: true };
  },
};
