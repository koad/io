#!/usr/bin/env python3
"""
opencode probe — quiz an entity through its opencode HTTP API.

Posts questions to a running opencode session, reads responses via
polling, and reports results. Used for entity sanity testing: does
the entity know what it should know?

Usage:
    probe.py --host 10.10.10.10 --port 28707 --quiz ~/.juno/quizzes/kingdom/basics.json
    probe.py --host 10.10.10.10 --port 28707 --question "What is your name and role?"
    probe.py --discover                        # list SSE-capable sessions from daemon

Quiz format (JSON):
    {
      "name": "Kingdom Basics",
      "scope": "kingdom",
      "questions": [
        {
          "id": "identity",
          "prompt": "What is your name, role, and who created you?",
          "expect": ["entity name", "role", "koad"],
          "weight": 1
        }
      ]
    }

The probe does NOT auto-score (that requires LLM judgment). It collects
responses and writes a structured report for review.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

DAEMON_URL = os.environ.get('KOAD_IO_DAEMON_URL', 'http://10.10.10.10:28282')
TIMEOUT = 30
POLL_INTERVAL = 2
MAX_WAIT = 120


def http_get(url, timeout=TIMEOUT):
    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read())


def http_post(url, body=None, timeout=TIMEOUT):
    data = json.dumps(body).encode() if body else b'{}'
    req = urllib.request.Request(
        url, data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    resp = urllib.request.urlopen(req, timeout=timeout)
    raw = resp.read()
    if not raw:
        return {}
    return json.loads(raw)


def discover_sessions():
    """List all SSE-capable opencode sessions from the daemon."""
    data = http_get(f'{DAEMON_URL}/api/emissions/active')
    sessions = []
    for e in data.get('emissions', data) if isinstance(data, dict) else data:
        meta = e.get('meta', {})
        if meta.get('capabilities') and 'sse' in meta['capabilities']:
            sessions.append({
                'entity': e.get('entity'),
                'host': meta.get('sseHost'),
                'port': meta.get('ssePort'),
                'cwd': meta.get('cwd'),
                'model': meta.get('model'),
                'pid': meta.get('pid'),
            })
    return sessions


def list_sessions(base_url):
    """List sessions on an opencode instance."""
    return http_get(f'{base_url}/session')


def create_session(base_url):
    """Create a new session for quiz isolation."""
    return http_post(f'{base_url}/session')


def send_message_tui(base_url, text):
    """Send a message through the TUI — same path as user typing."""
    http_post(f'{base_url}/tui/append-prompt', {'text': text})
    return http_post(f'{base_url}/tui/submit-prompt')


def send_message_api(base_url, session_id, text, agent=None):
    """Post via session API (back door — bypasses TUI agent selection)."""
    body = {
        'parts': [{'type': 'text', 'text': text}]
    }
    if agent:
        body['agent'] = agent
    return http_post(f'{base_url}/session/{session_id}/prompt_async', body)


def get_messages(base_url, session_id, limit=10):
    """Read messages from a session."""
    return http_get(f'{base_url}/session/{session_id}/message?limit={limit}')


def _msg_role(msg):
    return msg.get('role', msg.get('info', {}).get('role', ''))


def _msg_finished(msg):
    info = msg.get('info', msg)
    return info.get('finish') is not None or info.get('time', {}).get('completed') is not None


def _msg_text(msg):
    parts = msg.get('parts', [])
    return '\n'.join(p.get('text', '') for p in parts if p.get('type') == 'text')


def _msg_reasoning(msg):
    parts = msg.get('parts', [])
    return '\n'.join(p.get('text', '') for p in parts if p.get('type') == 'reasoning')


def llm_judge(base_url, question, response, expect, reasoning=''):
    """Use opencode's build agent as a neutral judge.

    Creates a fresh session, asks 'does this response demonstrate knowledge
    of the expected concepts?', returns {status, reasoning}. Separate from
    the entity's TUI session so it doesn't pollute their history.
    """
    try:
        sess = create_session(base_url)
        sid = sess.get('id')
        if not sid:
            return None

        expect_str = ', '.join(expect) if expect else '(none specified)'
        judge_prompt = (
            "You are grading an entity's answer on a knowledge quiz. "
            "Judge whether the answer demonstrates understanding of the expected concepts. "
            "Be charitable — synonyms and paraphrasing count. "
            "A response that gets the concept right with different words is still pass.\n\n"
            f"QUESTION: {question}\n\n"
            f"EXPECTED CONCEPTS: {expect_str}\n\n"
            f"ENTITY'S ANSWER: {response}\n"
        )
        if reasoning:
            judge_prompt += f"\nENTITY'S REASONING (private thinking trace, if present): {reasoning[:1500]}\n"

        judge_prompt += (
            "\nReturn ONLY a single-line JSON object, no prose, no code fences:\n"
            '{"status": "pass" | "partial" | "fail", "reasoning": "<one short sentence>"}\n'
        )

        send_ts = int(time.time() * 1000)
        send_message_api(base_url, sid, judge_prompt, agent='build')
        result_text, _ = wait_for_response(base_url, sid, send_ts, max_wait=60)
        if not result_text:
            return None

        import re
        for m in re.finditer(r'\{[^{}]*"status"[^{}]*\}', result_text):
            try:
                parsed = json.loads(m.group())
                status = parsed.get('status', '').lower()
                if status in ('pass', 'partial', 'fail'):
                    return {'status': status, 'reasoning': parsed.get('reasoning', '')}
            except json.JSONDecodeError:
                continue
    except Exception as e:
        print(f'probe: judge error: {e}', file=sys.stderr)
    return None


def _msg_created_at(msg):
    return msg.get('info', msg).get('time', {}).get('created', 0)


def wait_for_response(base_url, session_id, after_ts, max_wait=MAX_WAIT):
    """Poll until a completed assistant message newer than after_ts appears.

    after_ts is a millisecond timestamp (opencode's time.created is ms).
    """
    deadline = time.time() + max_wait
    while time.time() < deadline:
        msgs = get_messages(base_url, session_id)
        items = msgs if isinstance(msgs, list) else msgs.get('messages', msgs.get('items', []))
        assistant_msgs = [m for m in items if _msg_role(m) == 'assistant']
        fresh = [m for m in assistant_msgs if _msg_created_at(m) > after_ts and _msg_finished(m)]
        if fresh:
            latest = max(fresh, key=_msg_created_at)
            return _msg_text(latest), latest
        time.sleep(POLL_INTERVAL)
    return None, None


def run_quiz(base_url, quiz_path, session_id=None, agent=None, port=None):
    """Run a quiz file against an opencode session."""
    with open(quiz_path) as f:
        quiz = json.load(f)

    if not session_id:
        session_id = get_active_session(base_url, port=port)
    if not session_id:
        print('probe: no active session found — has the entity been woken with "."?', file=sys.stderr)
        sys.exit(1)
    print(f'probe: using session {session_id}', file=sys.stderr)

    results = []

    for q in quiz.get('questions', []):
        qid = q.get('id', 'unknown')
        prompt = q['prompt']
        expect = q.get('expect', [])

        print(f'probe: [{qid}] asking...', file=sys.stderr)
        send_ts = int(time.time() * 1000)
        send_message_tui(base_url, prompt)

        # Sniff the SSE stream to learn the live sessionID — don't rely on shared DB
        sid = sniff_active_session_from_sse(base_url, timeout=5)
        if sid:
            session_id = sid

        if not session_id:
            print(f'probe: [{qid}] could not resolve active session', file=sys.stderr)
            results.append({'id': qid, 'prompt': prompt, 'expect': expect,
                            'response': None, 'status': 'timeout'})
            continue

        # Wait on the SSE stream for this turn's assistant message to fully complete.
        # The authoritative signal: message.updated with role=assistant AND time.completed set.
        msg_id = wait_for_assistant_complete(base_url, session_id, send_ts, timeout=240)

        # Small grace window — opencode sometimes takes a beat to commit the
        # final text parts to the message record after marking completed.
        time.sleep(1)

        response_text, raw = wait_for_response(base_url, session_id, send_ts)

        # If we know the specific message ID, prefer reading that directly
        if msg_id and raw:
            info = raw.get('info', {})
            if info.get('id') != msg_id:
                # wait_for_response picked a different message — re-fetch by ID
                try:
                    all_msgs = get_messages(base_url, session_id, limit=30)
                    items = all_msgs if isinstance(all_msgs, list) else all_msgs.get('messages', all_msgs.get('items', []))
                    for m in items:
                        if m.get('info', {}).get('id') == msg_id:
                            raw = m
                            response_text = _msg_text(m)
                            break
                except Exception:
                    pass

        if response_text is None:
            print(f'probe: [{qid}] timed out', file=sys.stderr)
            results.append({
                'id': qid, 'prompt': prompt, 'expect': expect,
                'response': None, 'status': 'timeout'
            })
            continue

        reasoning_text = _msg_reasoning(raw) if raw else ''

        # Keyword match — quick, lossy
        hits = [kw for kw in expect if kw.lower() in response_text.lower()]
        misses = [kw for kw in expect if kw.lower() not in response_text.lower()]
        keyword_status = 'pass' if not misses else 'partial' if hits else 'fail'

        # LLM judge — semantic, charitable (gets the final word)
        judge = llm_judge(base_url, prompt, response_text, expect, reasoning=reasoning_text)
        judge_status = judge.get('status') if judge else None
        judge_reasoning = judge.get('reasoning', '') if judge else ''

        # Judge wins if it responded, else fall back to keyword match
        final_status = judge_status or keyword_status

        results.append({
            'id': qid,
            'prompt': prompt,
            'expect': expect,
            'response': response_text[:2000],
            'reasoning': reasoning_text[:1500],
            'hits': hits,
            'misses': misses,
            'keyword_status': keyword_status,
            'judge_status': judge_status,
            'judge_reasoning': judge_reasoning,
            'status': final_status,
        })
        kw = f'kw={keyword_status}'
        jg = f'judge={judge_status}' if judge_status else 'judge=n/a'
        print(f'probe: [{qid}] {final_status}  ({kw}  {jg})', file=sys.stderr)

    summary = {
        'total': len(results),
        'pass': sum(1 for r in results if r['status'] == 'pass'),
        'partial': sum(1 for r in results if r['status'] == 'partial'),
        'fail': sum(1 for r in results if r['status'] == 'fail'),
        'timeout': sum(1 for r in results if r['status'] == 'timeout'),
    }
    report = {
        'quiz': quiz.get('name', os.path.basename(quiz_path)),
        'scope': quiz.get('scope', 'unknown'),
        'session_id': session_id,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'results': results,
        'summary': summary,
    }

    # Save full report to entity's QC history on disk
    entity = agent or 'unknown'
    if entity and entity != 'unknown':
        qc_dir = os.path.expanduser(f'~/.{entity}/qc')
        try:
            os.makedirs(qc_dir, exist_ok=True)
            quiz_slug = os.path.splitext(os.path.basename(quiz_path))[0]
            date_slug = time.strftime('%Y-%m-%d-%H%M%S', time.gmtime())
            qc_path = os.path.join(qc_dir, f'{date_slug}-{quiz_slug}.json')
            with open(qc_path, 'w') as f:
                json.dump(report, f, indent=2)
            report['saved_to'] = qc_path
        except OSError as e:
            print(f'probe: could not save QC report: {e}', file=sys.stderr)

    # Emit quiz result to daemon so the entity's profile page picks it up
    score = f"{summary['pass']}/{summary['total']}"
    body = f"{quiz.get('name', 'quiz')}: {score}"
    if summary['partial']:
        body += f" ({summary['partial']} partial)"
    if summary['fail']:
        body += f" ({summary['fail']} fail)"
    if summary['timeout']:
        body += f" ({summary['timeout']} timeout)"
    try:
        daemon_emit_notice(entity, body, meta={
            'quizResult': True,
            'quiz': quiz.get('name'),
            'scope': quiz.get('scope'),
            'score': score,
            'summary': summary,
            'results': [{'id': r['id'], 'status': r['status']} for r in results],
            'reportPath': report.get('saved_to'),
        })
    except Exception as e:
        print(f'probe: failed to emit quiz result: {e}', file=sys.stderr)

    return report


def run_self_quiz(base_url, agent, port=None):
    """Ask the entity what it thinks should be on its quiz.

    Entity proposes questions it believes test its own boundaries and knowledge.
    Output is saved to ~/.<entity>/qc/proposed/<date>-self-quiz.json for Juno's
    review. Accepted questions get promoted to the real quiz corpus.
    """
    self_prompt = (
        "Author a short quiz that someone could use to verify you're doing your job correctly. "
        "Think about the boundaries of your role — what you do, what you don't do, "
        "the key things someone would need to know about your specialty.\n\n"
        "Return ONLY a valid JSON object on a single line, no prose or code fences, with this exact shape:\n"
        '{"name": "<quiz name>", "scope": "entity", "questions": [ '
        '{"id": "<slug>", "prompt": "<question>", "expect": ["keyword1", "keyword2"]}, ... ]}\n\n'
        "Include 6-8 questions. For each 'expect' list, include 2-4 keywords that a correct answer "
        "would likely contain. Focus on boundaries (what you do NOT do) as much as capabilities."
    )

    send_ts = int(time.time() * 1000)
    send_message_tui(base_url, self_prompt)

    session_id = sniff_active_session_from_sse(base_url, timeout=5)
    if not session_id:
        print('probe: could not resolve active session for self-quiz', file=sys.stderr)
        return None

    response_text, raw = wait_for_response(base_url, session_id, send_ts, max_wait=420)
    if not response_text:
        print('probe: self-quiz timed out', file=sys.stderr)
        return None

    # Extract the JSON from the response
    import re
    proposed = None
    for pattern in [
        r'```json\s*(\{.*?\})\s*```',
        r'```\s*(\{.*?\})\s*```',
        r'(\{[^`]*"questions"[^`]*\})',
    ]:
        for m in re.finditer(pattern, response_text, re.DOTALL):
            try:
                proposed = json.loads(m.group(1))
                break
            except json.JSONDecodeError:
                continue
        if proposed:
            break

    if not proposed:
        print('probe: could not parse quiz JSON from self-quiz response', file=sys.stderr)
        print(f'probe: raw response:\n{response_text[:1000]}', file=sys.stderr)
        return None

    # Save to entity's proposed-quiz folder
    qc_dir = os.path.expanduser(f'~/.{agent}/qc/proposed')
    os.makedirs(qc_dir, exist_ok=True)
    date_slug = time.strftime('%Y-%m-%d-%H%M%S', time.gmtime())
    out_path = os.path.join(qc_dir, f'{date_slug}-self-quiz.json')
    with open(out_path, 'w') as f:
        json.dump({
            'proposed_by': agent,
            'proposed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'raw_response': response_text[:3000],
            'quiz': proposed,
        }, f, indent=2)

    try:
        daemon_emit_notice(agent, f'self-quiz proposed: {proposed.get("name", "untitled")} ({len(proposed.get("questions", []))} q)', meta={
            'selfQuizProposal': True,
            'proposalPath': out_path,
            'quizName': proposed.get('name'),
            'questionCount': len(proposed.get('questions', [])),
        })
    except Exception:
        pass

    return {'path': out_path, 'quiz': proposed}


def daemon_emit_notice(entity, body, meta=None):
    """Post a notice emission to the daemon."""
    payload = {'entity': entity, 'type': 'notice', 'body': body[:500]}
    if meta:
        payload['meta'] = meta
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{DAEMON_URL}/emit',
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    urllib.request.urlopen(req, timeout=5)


def sniff_active_session_from_sse(base_url, timeout=5):
    """Briefly tail the SSE stream and extract the active sessionID from any event.

    Robust because opencode's session DB is shared across instances; this
    asks the live server what it's currently working on.
    """
    try:
        req = urllib.request.Request(f'{base_url}/event', headers={'Accept': 'text/event-stream'})
        resp = urllib.request.urlopen(req, timeout=timeout)
        deadline = time.time() + timeout
        buf = b''
        while time.time() < deadline:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            if chunk == b'\n':
                line = buf.decode('utf-8', errors='replace').strip()
                buf = b''
                if line.startswith('data:'):
                    try:
                        event = json.loads(line[5:].strip())
                        props = event.get('properties', {})
                        sid = props.get('sessionID') or props.get('info', {}).get('sessionID')
                        if sid:
                            return sid
                    except json.JSONDecodeError:
                        continue
    except Exception:
        pass
    return None


def wait_for_assistant_complete(base_url, session_id, after_ts, timeout=240):
    """Block until an assistant message for this session is fully complete.

    The authoritative "response done" signal is a message.updated event where:
      - properties.info.role == 'assistant'
      - properties.info.time.completed is set (not just 'finish')
      - message was created after our send timestamp

    Watches the SSE stream — same surface the sidecar uses. Returns the
    completed message ID so the caller can fetch final text via REST.
    """
    try:
        req = urllib.request.Request(f'{base_url}/event', headers={'Accept': 'text/event-stream'})
        resp = urllib.request.urlopen(req, timeout=timeout)
        deadline = time.time() + timeout
        buf = b''
        while time.time() < deadline:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            if chunk == b'\n':
                line = buf.decode('utf-8', errors='replace').strip()
                buf = b''
                if not line.startswith('data:'):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue

                etype = event.get('type', '')
                props = event.get('properties', {})

                # Fallback idle signals — used only if we haven't seen a completed message
                if etype == 'session.idle':
                    sid = props.get('sessionID') or props.get('info', {}).get('sessionID')
                    if not session_id or sid == session_id:
                        return None  # idle without a clear completion — caller should poll

                if etype != 'message.updated':
                    continue
                info = props.get('info', {})
                if info.get('role') != 'assistant':
                    continue
                sid = info.get('sessionID')
                if session_id and sid != session_id:
                    continue
                # Must have completed time AND be after our send
                completed = info.get('time', {}).get('completed')
                created = info.get('time', {}).get('created', 0)
                if completed and created >= after_ts:
                    return info.get('id')
    except Exception:
        pass
    return None


def get_active_session(base_url, port=None):
    """Get the session the entity is actually in by sniffing its SSE stream.

    The session DB is shared across opencode instances (SQLite on disk).
    Picking by 'most recently updated' doesn't distinguish Alice vs Vulcan.
    But sniffing the instance's own SSE stream tells us exactly what's live.
    """
    sid = sniff_active_session_from_sse(base_url, timeout=3)
    if sid:
        return sid

    # Fallback — shared list, last resort
    sessions = http_get(f'{base_url}/session')
    if not isinstance(sessions, list) or not sessions:
        return None
    best = max(sessions, key=lambda s: s.get('time', {}).get('updated', 0))
    return best.get('id')


def run_single_question(base_url, question, session_id=None, agent=None, port=None):
    """Ask one question into the entity's active session."""
    send_ts = int(time.time() * 1000)
    send_message_tui(base_url, question)

    if not session_id:
        session_id = sniff_active_session_from_sse(base_url, timeout=5)

    if not session_id:
        print('probe: could not resolve active session', file=sys.stderr)
        sys.exit(1)

    response_text, _ = wait_for_response(base_url, session_id, send_ts)
    return response_text


def main():
    parser = argparse.ArgumentParser(description='Probe an opencode session')
    parser.add_argument('--host', default='10.10.10.10')
    parser.add_argument('--port', type=int)
    parser.add_argument('--agent', '-a', help='Agent name (entity handle — targets the entity system prompt)')
    parser.add_argument('--quiz', help='Path to quiz JSON file')
    parser.add_argument('--question', '-q', help='Single question to ask')
    parser.add_argument('--session', '-s', help='Existing session ID')
    parser.add_argument('--discover', action='store_true', help='List SSE-capable sessions')
    parser.add_argument('--self-quiz', action='store_true', dest='self_quiz',
                        help='Ask the entity to propose its own quiz questions')
    parser.add_argument('--output', '-o', help='Write report to file (default: stdout)')
    args = parser.parse_args()

    if args.discover:
        sessions = discover_sessions()
        if not sessions:
            print('No SSE-capable sessions found.')
            return
        for s in sessions:
            print(f"  {s['entity']:10s}  {s['host']}:{s['port']}  cwd={s['cwd']}  model={s['model']}")
        return

    if not args.port:
        print('error: --port required (or use --discover to find sessions)', file=sys.stderr)
        sys.exit(1)

    base_url = f'http://{args.host}:{args.port}'

    agent = args.agent
    if not agent:
        # Try daemon first (capabilities-based discovery)
        for s in discover_sessions():
            if s.get('port') == args.port:
                agent = s.get('entity')
                print(f'probe: auto-detected agent "{agent}" from daemon', file=sys.stderr)
                break
    if not agent:
        # Fallback: find the opencode pid listening on this port, read ENTITY from /proc
        try:
            import subprocess
            out = subprocess.check_output(['ss', '-tlnp'], text=True, stderr=subprocess.DEVNULL)
            for line in out.splitlines():
                if f':{args.port} ' in line and 'opencode' in line:
                    import re
                    m = re.search(r'pid=(\d+)', line)
                    if m:
                        pid = m.group(1)
                        with open(f'/proc/{pid}/environ', 'rb') as f:
                            env = f.read().decode('utf-8', errors='replace').split('\x00')
                            for kv in env:
                                if kv.startswith('ENTITY='):
                                    agent = kv.split('=',1)[1]
                                    print(f'probe: auto-detected agent "{agent}" from process env', file=sys.stderr)
                                    break
                    break
        except Exception:
            pass

    if args.quiz:
        report = run_quiz(base_url, args.quiz, args.session, agent=agent, port=args.port)
        output = json.dumps(report, indent=2)
        if args.output:
            with open(args.output, 'w') as f:
                f.write(output + '\n')
            print(f'probe: report written to {args.output}', file=sys.stderr)
        else:
            print(output)

    elif args.question:
        response = run_single_question(base_url, args.question, args.session, agent=agent, port=args.port)
        if response:
            print(response)
        else:
            print('(no response / timeout)', file=sys.stderr)
            sys.exit(1)

    elif args.self_quiz:
        if not agent:
            print('error: --self-quiz requires an agent (use --agent or auto-detect)', file=sys.stderr)
            sys.exit(1)
        result = run_self_quiz(base_url, agent, port=args.port)
        if result:
            print(f'probe: self-quiz proposed — {len(result["quiz"].get("questions", []))} questions', file=sys.stderr)
            print(f'probe: saved to {result["path"]}', file=sys.stderr)
            print(json.dumps(result['quiz'], indent=2))
        else:
            sys.exit(1)

    else:
        print('error: --quiz, --question, or --self-quiz required', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
