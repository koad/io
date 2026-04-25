#!/usr/bin/env python3
"""
emit — lifecycle telemetry to the koad:io daemon.

Single source of truth for the emission wire protocol. Both bash (via emit.sh
wrapping this CLI) and Python hooks (via direct import) call this module.

Module usage (Python hooks):
    sys.path.insert(0, os.path.expanduser('~/.koad-io/helpers'))
    from emit import emit_open, emit_update, emit_close
    eid = emit_open('vulcan', 'flight', 'building /traffic', meta={'parentId': 'abc'})
    emit_update(eid, 'tests passing')
    emit_close(eid, 'shipped')

CLI usage (called by emit.sh):
    emit.py emit <type> <body> [--meta JSON]
    emit.py open <type> <body> [--meta JSON] [--id-file PATH]
    emit.py update <body> (--id ID | --id-file PATH) [--meta JSON]
    emit.py close [body] (--id ID | --id-file PATH)
    emit.py resume [body] --id-file PATH [--meta JSON]

Gate:
    KOAD_IO_EMIT=1     opt-in per entity or per command (default: disabled)

Env:
    KOAD_IO_DAEMON_URL  default http://10.10.10.10:28282
    ENTITY              entity handle (derived from ENTITY_DIR if unset)
    ENTITY_DIR          fallback for entity derivation

Valid types:
    session       interactive harness (human at terminal)
    flight        dispatched agent (one-shot, subagent)
    service       long-running process (daemon, app)
    conversation  multi-party flow (round table, party line)
    hook          lifecycle event from a hook
    notice        fire-and-forget informational
    warning       fire-and-forget warning
    error         fire-and-forget error
    request       fire-and-forget request

Nesting: pass meta.parentId to link child emissions to a parent.
Query children via /api/emissions?parent=<id>.
"""

import json
import os
import sys
import urllib.request

DAEMON_URL = os.environ.get('KOAD_IO_DAEMON_URL', 'http://10.10.10.10:28282')
TIMEOUT = 2
HEALTH_TIMEOUT = 1

_health_cache = None


def _enabled():
    return os.environ.get('KOAD_IO_EMIT', '0') == '1'


def _entity():
    e = os.environ.get('ENTITY', '')
    if not e:
        d = os.environ.get('ENTITY_DIR', '')
        if d:
            e = os.path.basename(d).lstrip('.')
    return e or 'unknown'


def _check_health():
    """Cache health for the life of this process — one check per invocation."""
    global _health_cache
    if _health_cache is not None:
        return _health_cache
    try:
        urllib.request.urlopen(DAEMON_URL + '/api/health', timeout=HEALTH_TIMEOUT)
        _health_cache = True
    except Exception:
        _health_cache = False
    return _health_cache


def _post(path, payload):
    """POST JSON to the daemon. Returns parsed response or None on any failure."""
    if not _enabled():
        return None
    if not _check_health():
        return None
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            DAEMON_URL + path,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
        return json.loads(resp.read())
    except Exception:
        return None


def emit(entity=None, type='notice', body='', meta=None):
    """Fire-and-forget emission. Returns _id or None."""
    if not body:
        return None
    payload = {'entity': entity or _entity(), 'type': type, 'body': body[:500]}
    if meta:
        payload['meta'] = meta
    result = _post('/emit', payload)
    return result.get('_id') if result else None


def emit_open(entity=None, type='session', body='', meta=None, id_file=None):
    """Open a lifecycle emission. Returns _id. Persists to id_file if provided."""
    if not body:
        return None
    payload = {
        'entity': entity or _entity(),
        'type': type,
        'body': body[:500],
        'lifecycle': 'open',
    }
    if meta:
        payload['meta'] = meta
    result = _post('/emit', payload)
    eid = result.get('_id') if result else None
    if eid and id_file:
        try:
            with open(id_file, 'w') as f:
                f.write(eid)
        except Exception:
            pass
    return eid


def emit_update(_id, body, meta=None):
    """Append update to an open lifecycle emission."""
    if not _id or not body:
        return None
    payload = {'_id': _id, 'body': body[:500]}
    if meta:
        payload['meta'] = meta
    result = _post('/emit/update', payload)
    return result.get('_id') if result else None


def emit_status(_id, status_line):
    """Set the current activity headline on an open emission (replaced each call)."""
    if not _id or not status_line:
        return None
    payload = {'_id': _id, 'status_line': status_line[:500]}
    result = _post('/emit/update', payload)
    return result.get('_id') if result else None


def emit_note(_id, note):
    """Append a timeline note to an open emission (never replaced, push-only)."""
    if not _id or not note:
        return None
    payload = {'_id': _id, 'note': note[:2000]}
    result = _post('/emit/update', payload)
    return result.get('_id') if result else None


def emit_results(_id, results, results_type='markdown'):
    """Set the results payload on an emission. Replaces any prior results."""
    if not _id or results is None:
        return None
    payload = {'_id': _id, 'results': results, 'results_type': results_type}
    result = _post('/emit/update', payload)
    return result.get('_id') if result else None


def emit_close(_id, body=None):
    """Close a lifecycle emission."""
    if not _id:
        return None
    payload = {'_id': _id, 'body': (body or 'closed')[:500], 'action': 'close'}
    result = _post('/emit/update', payload)
    return result.get('_id') if result else None


def emit_resume(id_file, body=None, meta=None):
    """Load _id from id_file, post a resume update. Returns _id."""
    if not id_file or not os.path.exists(id_file):
        return None
    try:
        with open(id_file) as f:
            eid = f.read().strip()
    except Exception:
        return None
    if not eid:
        return None
    emit_update(eid, body or 'resumed', meta)
    return eid


# ---------------------------------------------------------------------------
# CLI dispatch — for bash callers via emit.sh
# ---------------------------------------------------------------------------

def _resolve_id(args):
    """Pull an emission ID from --id or --id-file."""
    if getattr(args, 'id', None):
        return args.id
    id_file = getattr(args, 'id_file', None)
    if id_file and os.path.exists(id_file):
        try:
            with open(id_file) as f:
                return f.read().strip()
        except Exception:
            return None
    return None


def _cli():
    import argparse
    parser = argparse.ArgumentParser(prog='emit')
    sub = parser.add_subparsers(dest='action', required=True)

    p_emit = sub.add_parser('emit')
    p_emit.add_argument('type')
    p_emit.add_argument('body')
    p_emit.add_argument('--meta')

    p_open = sub.add_parser('open')
    p_open.add_argument('type')
    p_open.add_argument('body')
    p_open.add_argument('--meta')
    p_open.add_argument('--id-file', dest='id_file')

    p_update = sub.add_parser('update')
    p_update.add_argument('body')
    p_update.add_argument('--id')
    p_update.add_argument('--id-file', dest='id_file')
    p_update.add_argument('--meta')

    p_close = sub.add_parser('close')
    p_close.add_argument('body', nargs='?', default='closed')
    p_close.add_argument('--id')
    p_close.add_argument('--id-file', dest='id_file')

    p_resume = sub.add_parser('resume')
    p_resume.add_argument('body', nargs='?', default='resumed')
    p_resume.add_argument('--id-file', dest='id_file', required=True)
    p_resume.add_argument('--meta')

    # Structured narration fields
    p_status = sub.add_parser('status-line',
        help='Set the current activity headline (replaced on each call)')
    p_status.add_argument('text')
    p_status.add_argument('--id')
    p_status.add_argument('--id-file', dest='id_file')

    p_note = sub.add_parser('note',
        help='Append a timeline note (never replaced, push-only)')
    p_note.add_argument('text')
    p_note.add_argument('--id')
    p_note.add_argument('--id-file', dest='id_file')

    p_results = sub.add_parser('results',
        help='Set the results payload (replaces prior results)')
    p_results.add_argument('text')
    p_results.add_argument('--id')
    p_results.add_argument('--id-file', dest='id_file')
    p_results.add_argument('--type', dest='results_type', default='markdown')

    args = parser.parse_args()
    meta = json.loads(args.meta) if getattr(args, 'meta', None) else None

    if args.action == 'emit':
        emit(type=args.type, body=args.body, meta=meta)

    elif args.action == 'open':
        eid = emit_open(type=args.type, body=args.body, meta=meta, id_file=args.id_file)
        if eid:
            print(eid)

    elif args.action == 'update':
        eid = _resolve_id(args)
        if eid:
            emit_update(eid, args.body, meta)

    elif args.action == 'close':
        eid = _resolve_id(args)
        if eid:
            emit_close(eid, args.body)
            # Clean up id file on close
            id_file = getattr(args, 'id_file', None)
            if id_file and os.path.exists(id_file):
                try:
                    os.remove(id_file)
                except Exception:
                    pass

    elif args.action == 'resume':
        eid = emit_resume(args.id_file, args.body, meta)
        if eid:
            print(eid)

    elif args.action == 'status-line':
        eid = _resolve_id(args)
        if eid:
            emit_status(eid, args.text)

    elif args.action == 'note':
        eid = _resolve_id(args)
        if eid:
            emit_note(eid, args.text)

    elif args.action == 'results':
        eid = _resolve_id(args)
        if eid:
            emit_results(eid, args.text, getattr(args, 'results_type', 'markdown'))


if __name__ == '__main__':
    _cli()
