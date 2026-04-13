// DDP Gate — requires a valid Meteor DDP session before allowing harness chat.
//
// How it works:
// 1. Browser loads the page → Meteor DDP handshake happens automatically
// 2. Client calls Meteor method `harness.token` → gets a short-lived token
// 3. Client sends token with each POST /chat request
// 4. Harness validates the token before processing
//
// curl/scripts never establish DDP, so they can't get a token.

const tokens = new Map();
const TOKEN_TTL = 30 * 60 * 1000; // 30 minutes

function generateToken() {
  return Random.id(32);
}

function issueToken(connectionId) {
  // Clean expired tokens opportunistically
  const now = Date.now();
  if (tokens.size > 1000) {
    for (const [t, entry] of tokens) {
      if (now - entry.issuedAt > TOKEN_TTL) tokens.delete(t);
    }
  }

  const token = generateToken();
  tokens.set(token, {
    connectionId,
    issuedAt: now,
  });
  return token;
}

function validateToken(token) {
  if (!token) return false;
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() - entry.issuedAt > TOKEN_TTL) {
    tokens.delete(token);
    return false;
  }
  return true;
}

// Meteor method — only callable over DDP (browser with live websocket)
Meteor.methods({
  'harness.token'() {
    if (!this.connection) {
      throw new Meteor.Error('no-connection', 'DDP connection required');
    }
    return issueToken(this.connection.id);
  },
});

// Periodic cleanup
Meteor.setInterval(() => {
  const cutoff = Date.now() - TOKEN_TTL;
  for (const [t, entry] of tokens) {
    if (entry.issuedAt < cutoff) tokens.delete(t);
  }
}, 5 * 60 * 1000);

KoadHarnessDdpGate = { validateToken };
