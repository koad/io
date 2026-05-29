#!/usr/bin/env python3
"""Pi RPC dispatch — launch pi in RPC mode, stream events, capture session.

Usage: pi_rpc_dispatch.py <pi_bin> [base_flags...]

Reads PROMPT, HARNESS_EMISSION_ID, KOAD_IO_HARNESS_SESSIONS_DIR, ENTITY,
HARNESS_SESSION_ID from environment.

Flow:
  1. Launch pi --mode rpc as a subprocess
  2. Send {"type":"prompt","message":"<task>"}
  3. Stream events: tool calls → emit notes, turn_end → cost notes
  4. On agent_end: capture get_session_stats + get_last_assistant_text
  5. Write dispatch-control.json with pi session file path
  6. Print final assistant text to stdout
  7. Exit with pi's return code
"""

import json
import os
import subprocess
import sys
import threading
import time

# Direct emit module integration — no subprocess needed
_sys_emit_path = os.path.expanduser("~/.koad-io/helpers")
if _sys_emit_path not in sys.path:
    sys.path.insert(0, _sys_emit_path)
_emit_id = os.environ.get("HARNESS_EMISSION_ID", "")
try:
    from emit import emit_note as _emit_note, emit_status as _emit_status

    def _note(msg):
        if _emit_id:
            try:
                _emit_note(_emit_id, msg)
            except Exception:
                pass

    def _status(msg):
        if _emit_id:
            try:
                _emit_status(_emit_id, msg)
            except Exception:
                pass
except ImportError:

    def _note(msg):
        pass

    def _status(msg):
        pass


def _args_brief(args):
    if not isinstance(args, dict) or not args:
        return ""
    parts = [f"{k}={str(v)[:40]}" for k, v in list(args.items())[:3]]
    s = ", ".join(parts)
    if len(args) > 3:
        s += f" …+{len(args)-3}"
    return f": {s}"


def main():
    pi_bin = sys.argv[1]
    base_flags = sys.argv[2:]
    prompt = os.environ.get("PROMPT", "")
    dispatch_control_file = (
        os.environ.get("KOAD_IO_HARNESS_SESSIONS_DIR", "").replace("/sessions", "")
        + "/dispatch-control.json"
    )
    entity = os.environ.get("ENTITY", "unknown")
    harness_session_id = os.environ.get("HARNESS_SESSION_ID", "")
    emission_id = os.environ.get("HARNESS_EMISSION_ID", "")

    # Launch pi in RPC mode
    cmd = [pi_bin, "--mode", "rpc"] + base_flags
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        bufsize=1,
    )

    def send(obj):
        """Send a JSONL command to pi's RPC stdin."""
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()

    # State tracked across events
    session_file = None
    final_text = None
    agent_done = threading.Event()

    def reader():
        nonlocal session_file, final_text
        for raw_line in proc.stdout:
            line = raw_line.rstrip("\r\n")
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue

            ev_type = ev.get("type", "")

            if ev_type == "response":
                cmd_name = ev.get("command", "")
                if cmd_name == "get_session_stats" and ev.get("success"):
                    data = ev.get("data", {})
                    session_file = data.get("sessionFile")
                    if session_file:
                        payload = {
                            "piSessionFile": session_file,
                            "sessionId": data.get("sessionId"),
                            "entity": entity,
                            "harnessSessionId": harness_session_id,
                            "emissionId": emission_id,
                            "model": (
                                (data.get("model") or {}).get("id")
                                if isinstance(data.get("model"), dict)
                                else None
                            ),
                            "capturedAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                            ),
                        }
                        try:
                            tmp = dispatch_control_file + ".tmp." + str(os.getpid())
                            with open(tmp, "w") as f:
                                json.dump(payload, f)
                            os.replace(tmp, dispatch_control_file)
                        except OSError:
                            pass
                elif cmd_name == "get_last_assistant_text" and ev.get("success"):
                    final_text = (ev.get("data") or {}).get("text")
                continue

            elif ev_type == "tool_execution_start":
                tool_name = ev.get("toolName", "?")
                args_brief = _args_brief(ev.get("args") or {})
                _note(f"→ {tool_name}{args_brief}")
                _status(f"tool: {tool_name}")

            elif ev_type == "tool_execution_end":
                tool_name = ev.get("toolName", "?")
                is_error = ev.get("isError", False)
                _note(f"← {tool_name} {'ERROR' if is_error else 'ok'}")

            elif ev_type == "turn_end":
                msg_data = ev.get("message") or {}
                usage = msg_data.get("usage") or {}
                cost_obj = usage.get("cost") or {}
                total_cost = cost_obj.get("total")
                model_info = msg_data.get("model") or {}
                model_id = (
                    model_info.get("id") if isinstance(model_info, dict) else None
                )
                if total_cost is not None:
                    cost_str = f"${total_cost:.4f}"
                    model_str = f" ({model_id})" if model_id else ""
                    _note(f"turn: {cost_str}{model_str}")

            if ev_type == "agent_end":
                _status("agent done, capturing stats")
                send({"type": "get_session_stats"})
                send({"type": "get_last_assistant_text"})
                agent_done.set()

        agent_done.set()

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    send({"type": "prompt", "message": prompt})

    agent_done.wait(timeout=6000)
    time.sleep(0.5)

    try:
        proc.stdin.close()
    except OSError:
        pass

    t.join(timeout=5)
    proc.wait(timeout=10)

    if final_text:
        print(final_text)

    # Normalize rc=120 to success when completion evidence is present.
    # Pi RPC one-shot returns 120 on normal completion in many cases —
    # agent_end may or may not have been emitted before stdout closed.
    # Fallback: if agent_done fired (stdout EOF) but we never got stats
    # via RPC, check disk for the session file Pi always writes.
    rc = proc.returncode or 0

    if rc == 120 and agent_done.is_set() and not (final_text or session_file):
        pi_dir = os.environ.get(
            "PI_CODING_AGENT_DIR",
            os.path.expanduser("~/.local/share/koad-io/harnesses/pi"),
        )
        entity_dir = os.environ.get("ENTITY_DIR", "")
        if entity_dir:
            entity_slug = "--" + entity_dir.lstrip("/").replace("/", "-") + "--"
            sess_dir = os.path.join(pi_dir, "sessions", entity_slug)
            if os.path.isdir(sess_dir):
                try:
                    files = sorted(os.listdir(sess_dir), reverse=True)
                    if files:
                        session_file = os.path.join(sess_dir, files[0])
                except OSError:
                    pass
        if session_file:
            try:
                payload = {
                    "piSessionFile": session_file,
                    "sessionId": None,
                    "entity": entity,
                    "harnessSessionId": harness_session_id,
                    "emissionId": emission_id,
                    "model": None,
                    "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "fallback": True,
                }
                tmp = dispatch_control_file + ".tmp." + str(os.getpid())
                with open(tmp, "w") as f:
                    json.dump(payload, f)
                os.replace(tmp, dispatch_control_file)
            except OSError:
                pass

    if rc == 120 and agent_done.is_set():
        rc = 0

    sys.exit(rc)


if __name__ == "__main__":
    main()
