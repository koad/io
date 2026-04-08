const INJECTION_PATTERNS = [
  /^system\s*:/im,
  /^###\s/m,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s/i,
  /forget\s+(all\s+)?(your\s+)?instructions/i,
  /new\s+instructions?\s*:/i,
  /\bprompt\s*injection\b/i,
  /\bdisregard\b.*\binstructions\b/i,
  /\boverride\b.*\bsystem\b/i,
  /\bact\s+as\b.*\b(root|admin|developer)\b/i,
];

KoadHarnessInputFilter = {
  filter(message, config = {}) {
    const maxLength = config.maxLength || 2000;

    if (typeof message !== 'string') {
      return { allowed: false, reason: 'injection_detected', detail: 'Invalid input' };
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return { allowed: false, reason: 'empty', detail: 'Empty message' };
    }

    if (trimmed.length > maxLength) {
      return { allowed: true, message: trimmed.slice(0, maxLength) };
    }

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { allowed: false, reason: 'injection_detected', detail: 'Message not accepted' };
      }
    }

    return { allowed: true, message: trimmed };
  },
};
