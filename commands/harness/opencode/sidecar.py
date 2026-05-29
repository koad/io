#!/usr/bin/env python3
"""
opencode SSE sidecar — tails an opencode session's /event stream,
computes cost from tokens × model-prices.json, and heartbeats into
the daemon emission for this session.

Also writes/updates a session JSON at
  KOAD_IO_HARNESS_SESSIONS_DIR/<sessionId>.json
conforming to the VESTA-SPEC-142 opencode shape expected by
session-scanner.js. The command.sh launcher writes a pid-named stub
before exec; we rename it to <sessionId>.json on first sessionID
discovery, then update lastSeen on each heartbeat, and remove on exit.

Spawned by the harness command.sh when KOAD_IO_OPENCODE_SSE_PORT is set.
Dies when the parent harness exits (reads PPID or stdin EOF).

Env required:
    KOAD_IO_OPENCODE_SSE_PORT   port opencode is listening on
    KOAD_IO_BIND_IP             bind address (default 127.0.0.1)
    HARNESS_EMISSION_ID_FILE    file containing the session's emission ID (KOAD_IO_EMISSION_ID_FILE also accepted)
    ENTITY                      entity handle

Env optional:
    KOAD_IO_DAEMON_URL              default http://10.10.10.10:28282
    KOAD_IO_MODEL_PRICES            path to model-prices.json
    KOAD_IO_HARNESS_PID             PID of the parent harness process (for reopen meta)
    KOAD_IO_HARNESS_SESSIONS_DIR    directory for session JSON files (set by command.sh)
"""

import json
import os
import signal
import sys
import time
import urllib.request
import urllib.error

DAEMON_URL = os.environ.get('KOAD_IO_DAEMON_URL', 'http://10.10.10.10:28282')
SSE_HOST = os.environ.get('KOAD_IO_BIND_IP', '127.0.0.1')
SSE_PORT = os.environ.get('KOAD_IO_OPENCODE_SSE_PORT', '')
ENTITY = os.environ.get('ENTITY', 'unknown')
EMISSION_ID_FILE = os.environ.get('HARNESS_EMISSION_ID_FILE', os.environ.get('KOAD_IO_EMISSION_ID_FILE', ''))
HARNESS_PID = os.environ.get('KOAD_IO_HARNESS_PID', '')
PRICES_PATH = os.environ.get(
    'KOAD_IO_MODEL_PRICES',
    os.path.expanduser('~/.koad-io/config/model-prices.json')
)
# Session JSON dir — set by command.sh to $ENTITY_DIR/.local/state/harness/sessions/
SESSIONS_DIR = os.environ.get('KOAD_IO_HARNESS_SESSIONS_DIR', '')

HEARTBEAT_INTERVAL = 3
TIMEOUT = 2

# Max consecutive reopen attempts before giving up
MAX_REOPEN_ATTEMPTS = 3


def load_prices():
    try:
        with open(PRICES_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def get_rate(prices, provider, model):
    provider_rates = prices.get(provider, {})
    return provider_rates.get(model, provider_rates.get('_default', {
        'input': 0, 'output': 0, 'cache_read': 0, 'cache_write': 0
    }))


def compute_cost(tokens, rate):
    cost = 0.0
    cost += tokens.get('input', 0) / 1000 * rate.get('input', 0)
    cost += tokens.get('output', 0) / 1000 * rate.get('output', 0)
    cache = tokens.get('cache', {})
    cost += cache.get('read', 0) / 1000 * rate.get('cache_read', 0)
    cost += cache.get('write', 0) / 1000 * rate.get('cache_write', 0)
    return round(cost, 6)


def read_emission_id():
    if not EMISSION_ID_FILE:
        return None
    for _ in range(30):
        try:
            with open(EMISSION_ID_FILE) as f:
                eid = f.read().strip()
                if eid:
                    return eid
        except OSError:
            pass
        time.sleep(0.5)
    return None


def write_emission_id(new_id):
    """Atomically update the emission ID file with a new ID."""
    if not EMISSION_ID_FILE:
        return
    tmp = EMISSION_ID_FILE + '.tmp'
    try:
        with open(tmp, 'w') as f:
            f.write(new_id)
        os.replace(tmp, EMISSION_ID_FILE)
    except OSError as e:
        print(f'[sidecar:{ENTITY}] failed to write new emission ID: {e}', file=sys.stderr)


def daemon_post(path, body):
    """POST to daemon. Returns HTTP status code, or None on network error.

    Distinguishes HTTP errors (returns status code) from transient
    network/OS errors (returns None). Callers can act on 404 specifically.
    """
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f'{DAEMON_URL}{path}',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=TIMEOUT)
        return 200
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return None


def emit_open_session(body, meta=None):
    """Open a new lifecycle session emission. Returns the new _id or None."""
    payload = {
        'entity': ENTITY,
        'type': 'session',
        'body': body,
        'lifecycle': 'open',
    }
    if meta:
        payload['meta'] = meta
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            f'{DAEMON_URL}/emit',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        result = json.loads(resp.read().decode())
        return result.get('_id')
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None


def emit_update(emission_id, body, meta=None):
    """Update a lifecycle emission. Returns HTTP status code or None on error."""
    payload = {'_id': emission_id, 'body': body}
    if meta:
        payload['meta'] = meta
    return daemon_post('/emit/update', payload)


def reopen_emission(old_id, sidecar_state):
    """Reopen a session emission after a 404. Returns new ID or None."""
    harness_pid = HARNESS_PID or str(os.getppid())
    meta = {
        'harness': 'opencode',
        'pid': int(harness_pid) if harness_pid.isdigit() else 0,
        'host': os.uname().nodename,
        'reopened': True,
    }
    # Carry forward any already-seen state so the new emission isn't empty
    if sidecar_state:
        meta['sidecar'] = sidecar_state

    new_id = emit_open_session(
        'sidecar: recovered after daemon restart',
        meta=meta,
    )
    return new_id


def tail_sse(url):
    req = urllib.request.Request(url, headers={'Accept': 'text/event-stream'})
    resp = urllib.request.urlopen(req, timeout=300)

    buf = b''
    while True:
        chunk = resp.read(1)
        if not chunk:
            break
        buf += chunk
        if chunk == b'\n':
            line = buf.decode('utf-8', errors='replace').strip()
            buf = b''
            if line.startswith('data:'):
                yield line[5:].strip()


PARENT_PID = os.getppid()


def parent_alive():
    return os.getppid() == PARENT_PID


def fetch_model_limits():
    """Fetch /provider once at startup. Returns dict {(providerID, modelID): context_limit}.

    On failure (network error, unexpected shape): logs to stderr and returns {}
    so the rest of the session continues without contextPct.
    """
    if not SSE_PORT:
        return {}
    url = f'http://{SSE_HOST}:{SSE_PORT}/provider'
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        data = json.loads(resp.read().decode())
        limits = {}
        for provider in data.get('all', []):
            provider_id = provider.get('id', '')
            for model_id, model_info in provider.get('models', {}).items():
                limit = model_info.get('limit', {}).get('context')
                if limit:
                    limits[(provider_id, model_id)] = limit
        print(f'sidecar: loaded {len(limits)} model context limits from /provider', file=sys.stderr)
        return limits
    except Exception as e:
        print(f'sidecar: WARNING — /provider unreachable ({e}); contextPct will be omitted this session', file=sys.stderr)
        return {}


# ---------------------------------------------------------------------------
# Session JSON — VESTA-SPEC-142 / brief 2026-05-12
# ---------------------------------------------------------------------------
#
# The command.sh launcher writes a stub at sessions/<pid>.json before exec.
# We rename it to sessions/<sessionId>.json on first sessionID discovery,
# then update lastSeen on heartbeats, and remove on exit.
# The session-scanner.js json-scanner picks this up and upserts a canonical
# HarnessSessions record with the opencode-specific fields.

def _now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _stub_path():
    """Return the pid-named stub path (may no longer exist if already renamed)."""
    if not SESSIONS_DIR:
        return None
    harness_pid = HARNESS_PID or str(os.getpid())
    return os.path.join(SESSIONS_DIR, f'{harness_pid}.json')


def _session_json_path(session_id):
    if not SESSIONS_DIR or not session_id:
        return None
    return os.path.join(SESSIONS_DIR, f'{session_id}.json')


def _write_session_json(path, doc):
    """Atomically write a JSON document to path."""
    if not path:
        return
    tmp = path + '.tmp'
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, 'w') as f:
            json.dump(doc, f, separators=(',', ':'))
            f.write('\n')
        os.replace(tmp, path)
    except OSError as e:
        print(f'[sidecar:{ENTITY}] session JSON write failed ({path}): {e}', file=sys.stderr)
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _remove_session_json(path):
    if path:
        try:
            os.unlink(path)
        except OSError:
            pass


def register_session(session_id, model_id, provider_id, cost, tokens_in, tokens_out, context_pct, context_limit):
    """Write the full session JSON (renamed from stub). Returns path of written file."""
    if not SESSIONS_DIR or not session_id:
        return None
    harness_pid_str = HARNESS_PID or str(os.getpid())
    host = os.uname().nodename
    now = _now_iso()
    port = int(SSE_PORT) if SSE_PORT else None

    doc = {
        'sessionId': session_id,
        'entity': ENTITY,
        'harness': 'opencode',
        'host': host,
        'pid': int(harness_pid_str) if harness_pid_str.isdigit() else 0,
        'model': model_id,
        'provider': provider_id,
        'cwd': os.environ.get('PWD', ''),
        'lastSeen': now,
    }
    if port:
        doc['port'] = port
        doc['hostname'] = SSE_HOST
        doc['endpoints'] = {
            'sse': f'http://{SSE_HOST}:{port}/global/event',
            'tuiAppend': f'http://{SSE_HOST}:{port}/tui/append-prompt',
            'tuiSubmit': f'http://{SSE_HOST}:{port}/tui/submit-prompt',
            'messages': f'http://{SSE_HOST}:{port}/session/{session_id}/message',
        }
    if cost:
        doc['cost'] = cost
    if tokens_in:
        doc['tokensIn'] = tokens_in
    if tokens_out:
        doc['tokensOut'] = tokens_out
    if context_pct is not None:
        doc['contextPct'] = context_pct
    if context_limit is not None:
        doc['contextLimit'] = context_limit

    session_path = _session_json_path(session_id)

    # Remove the pid-named stub now that we have a proper sessionId-named file
    stub = _stub_path()
    if stub and stub != session_path:
        _remove_session_json(stub)

    _write_session_json(session_path, doc)
    print(f'[sidecar:{ENTITY}] session JSON written: {session_path}', file=sys.stderr)
    return session_path


def update_session_json(session_id, model_id, provider_id, cost, tokens_in, tokens_out, context_pct, context_limit):
    """Update lastSeen + telemetry fields in the existing session JSON."""
    if not SESSIONS_DIR or not session_id:
        return
    session_path = _session_json_path(session_id)
    if not session_path:
        return
    # Read existing or reconstruct minimal doc
    doc = {}
    try:
        with open(session_path) as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

    doc['lastSeen'] = _now_iso()
    if model_id:
        doc['model'] = model_id
    if provider_id:
        doc['provider'] = provider_id
    if cost is not None:
        doc['cost'] = cost
    if tokens_in is not None:
        doc['tokensIn'] = tokens_in
    if tokens_out is not None:
        doc['tokensOut'] = tokens_out
    if context_pct is not None:
        doc['contextPct'] = context_pct
    if context_limit is not None:
        doc['contextLimit'] = context_limit

    _write_session_json(session_path, doc)


def run():
    if not SSE_PORT:
        sys.exit(0)

    prices = load_prices()
    model_limits = fetch_model_limits()
    emission_id = read_emission_id()
    if not emission_id:
        print(f'sidecar: no emission ID after 15s, exiting', file=sys.stderr)
        sys.exit(1)

    sse_url = f'http://{SSE_HOST}:{SSE_PORT}/event'
    print(f'sidecar: tailing {sse_url} → emission {emission_id}', file=sys.stderr)

    cumulative_cost = 0.0
    cumulative_tokens_in = 0
    cumulative_tokens_out = 0
    last_heartbeat = 0
    last_model = ''
    last_provider = ''
    active_session_id = ''
    session_json_registered = False  # True once we've written the full session JSON

    # Tracks consecutive reopen failures to avoid infinite retry loops
    consecutive_reopen_failures = 0
    last_context_pct = None
    last_context_limit = None

    print(f'sidecar: waiting for port {SSE_PORT} to open...', file=sys.stderr)

    def current_sidecar_state():
        state = {
            'cost': cumulative_cost,
            'tokensIn': cumulative_tokens_in,
            'tokensOut': cumulative_tokens_out,
            'model': last_model,
            'provider': last_provider,
            'activeSessionId': active_session_id,
        }
        if last_context_pct is not None:
            state['contextPct'] = last_context_pct
        if last_context_limit is not None:
            state['contextLimit'] = last_context_limit
        return state

    def handle_404(old_id):
        """Handle a 404 from /emit/update. Returns new emission_id or None if giving up."""
        nonlocal consecutive_reopen_failures
        if consecutive_reopen_failures >= MAX_REOPEN_ATTEMPTS:
            print(
                f'[sidecar:{ENTITY}] {MAX_REOPEN_ATTEMPTS} consecutive reopen failures — giving up',
                file=sys.stderr,
            )
            return None

        new_id = reopen_emission(old_id, current_sidecar_state())
        if new_id:
            consecutive_reopen_failures = 0
            write_emission_id(new_id)
            print(
                f'[sidecar:{ENTITY}] emission {old_id} 404 — reopened as {new_id}',
                file=sys.stderr,
            )
            return new_id
        else:
            consecutive_reopen_failures += 1
            print(
                f'[sidecar:{ENTITY}] emission {old_id} 404 — reopen failed '
                f'({consecutive_reopen_failures}/{MAX_REOPEN_ATTEMPTS})',
                file=sys.stderr,
            )
            return None

    for attempt in range(120):
        try:
            for data_str in tail_sse(sse_url):
                try:
                    event = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                etype = event.get('type', '')
                props = event.get('properties', {})

                # Track active session from any event that carries sessionID
                sid = props.get('sessionID') or props.get('info', {}).get('sessionID')
                if sid and sid != active_session_id:
                    active_session_id = sid
                    # First sessionID discovery — write the full session JSON and
                    # remove the pid-named stub the launcher left behind.
                    if not session_json_registered:
                        session_json_registered = True
                        register_session(
                            sid, last_model, last_provider,
                            cumulative_cost, cumulative_tokens_in, cumulative_tokens_out,
                            last_context_pct, last_context_limit,
                        )
                elif sid and not session_json_registered:
                    # Same sessionID repeated before we registered (e.g. fast events)
                    active_session_id = sid
                    session_json_registered = True
                    register_session(
                        sid, last_model, last_provider,
                        cumulative_cost, cumulative_tokens_in, cumulative_tokens_out,
                        last_context_pct, last_context_limit,
                    )

                if etype == 'message.updated':
                    info = props.get('info', {})

                    if info.get('role') != 'assistant':
                        continue

                    tokens = info.get('tokens', {})
                    if not tokens.get('output', 0) and not tokens.get('input', 0):
                        continue

                    model_id = info.get('modelID', last_model)
                    provider_id = info.get('providerID', last_provider)
                    last_model = model_id
                    last_provider = provider_id

                    rate = get_rate(prices, provider_id, model_id)
                    msg_cost = compute_cost(tokens, rate)

                    tokens_in = tokens.get('input', 0) + tokens.get('cache', {}).get('read', 0)
                    tokens_out = tokens.get('output', 0)

                    cumulative_cost = msg_cost
                    cumulative_tokens_in = tokens_in
                    cumulative_tokens_out = tokens_out

                    # contextPct — use tokens.total (opencode's authoritative measure)
                    context_limit = model_limits.get((provider_id, model_id))
                    if context_limit:
                        total_tokens = tokens.get('total', 0)
                        last_context_pct = round((total_tokens / context_limit) * 100, 1)
                        last_context_limit = context_limit

                    now = time.time()
                    if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                        status = emit_update(emission_id, f'sidecar: cost=${cumulative_cost:.4f}', {
                            'sidecar': current_sidecar_state(),
                        })
                        if status == 404:
                            new_id = handle_404(emission_id)
                            if new_id is None:
                                return
                            emission_id = new_id
                        elif status is not None:
                            # Successful update resets consecutive failure counter
                            consecutive_reopen_failures = 0
                        last_heartbeat = now
                        # Heartbeat: update the session JSON lastSeen + telemetry
                        if session_json_registered and active_session_id:
                            update_session_json(
                                active_session_id, last_model, last_provider,
                                cumulative_cost, cumulative_tokens_in, cumulative_tokens_out,
                                last_context_pct, last_context_limit,
                            )

                elif etype == 'session.idle':
                    status = emit_update(emission_id, f'sidecar: idle cost=${cumulative_cost:.4f}', {
                        'sidecar': {
                            **current_sidecar_state(),
                            'idle': True,
                        },
                    })
                    if status == 404:
                        new_id = handle_404(emission_id)
                        if new_id is None:
                            return
                        emission_id = new_id
                    elif status is not None:
                        consecutive_reopen_failures = 0
                    last_heartbeat = time.time()
                    # Idle event: bump lastSeen in the session JSON
                    if session_json_registered and active_session_id:
                        update_session_json(
                            active_session_id, last_model, last_provider,
                            cumulative_cost, cumulative_tokens_in, cumulative_tokens_out,
                            last_context_pct, last_context_limit,
                        )

        except (urllib.error.URLError, OSError, ConnectionError) as e:
            if attempt < 119:
                if not parent_alive():
                    return
                time.sleep(2)
                continue
            pass
            break

    if cumulative_cost > 0 or cumulative_tokens_out > 0:
        emit_update(emission_id, f'sidecar: final cost=${cumulative_cost:.4f}', {
            'sidecar': {
                **current_sidecar_state(),
                'final': True,
            },
        })

    # Remove session JSON on clean exit. The command.sh EXIT trap removes the
    # pid-named stub; we remove the sessionId-named file we wrote here.
    if session_json_registered and active_session_id:
        _remove_session_json(_session_json_path(active_session_id))
        print(f'[sidecar:{ENTITY}] session JSON removed on exit: {active_session_id[:16]}', file=sys.stderr)
    # Also remove the stub in case it was never renamed (e.g. no session events received)
    _remove_session_json(_stub_path())


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    try:
        run()
    except KeyboardInterrupt:
        pass
