// server/origin.js — shared origin identity for scanner + remote modes.
//
// Every app that handles entities (daemon, musium, website server) needs
// a stable identity it can append to the entity's source chain. Scanner
// stamps it as the first hop; remote appends itself as the next hop.
//
// Loaded after config.js, before scanner.js + remote.js.
// Works in all modes — no bail-out.

const fs = Npm.require('fs');
const path = Npm.require('path');

const ORIGIN_PATH = path.join(process.env.HOME, '.koad-io', 'daemon', 'origin.json');
let _originIdentity = null;

readOriginIdentity = function readOriginIdentity() {
  if (_originIdentity) return _originIdentity;

  try {
    const raw = fs.readFileSync(ORIGIN_PATH, 'utf8');
    _originIdentity = JSON.parse(raw);
    log.debug(`origin identity loaded: ${_originIdentity.id}`);
    return _originIdentity;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      log.error(`origin identity read error: ${e.message}`);
    }
  }

  // Instance id: KOAD_IO_INSTANCE env var, or random hex on first boot.
  // Set this to a stable name per deployment (e.g. "wonderland-daemon",
  // "musium", "koad-live-server") so the chain-of-custody is readable.
  const id = (process.env.KOAD_IO_INSTANCE || '').trim()
    || Array.from({ length: 8 }, () =>
         Math.random().toString(16).slice(2, 10)
       ).join('');

  // Resolve public URL: explicit override → kingdom domain → bind IP:port
  let url = (process.env.KOAD_IO_ENTITY_PUBLIC_URL || '').trim();
  if (!url) {
    const kingdom = (process.env.KOAD_IO_KINGDOM || '').trim();
    if (kingdom) {
      url = `https://${kingdom}`;
    } else {
      const bindIp = process.env.KOAD_IO_BIND_IP || '10.10.10.10';
      const port = process.env.KOAD_IO_PORT || '28282';
      url = `http://${bindIp}:${port}`;
    }
  }

  _originIdentity = {
    id,
    url,
    createdAt: new Date().toISOString(),
  };

  try {
    const dir = path.dirname(ORIGIN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ORIGIN_PATH, JSON.stringify(_originIdentity, null, 2) + '\n');
    log.debug(`origin generated: ${id} @ ${url}`);
  } catch (writeErr) {
    log.error(`origin write error: ${writeErr.message}`);
  }

  return _originIdentity;
};

// Append this instance's origin to an entity's source chain.
// Idempotent — won't append if this origin.id is already in the chain.
// Returns a new array; does not mutate the input.
appendOriginToSource = function appendOriginToSource(existingSource) {
  const origin = readOriginIdentity();
  const chain = Array.isArray(existingSource) ? [...existingSource] : [];
  const alreadyInChain = chain.some(s => s && s.id === origin.id);
  if (!alreadyInChain) {
    chain.push({
      id: origin.id,
      url: origin.url,
      at: new Date().toISOString(),  // when THIS entity was seen at THIS hop
    });
  }
  return chain;
};
