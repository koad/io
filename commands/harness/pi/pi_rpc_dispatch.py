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
    from emit import emit_note as _emit_note, emit_status as _emit_status, emit_results as _emit_results

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

    def _results(msg):
        if _emit_id:
            try:
                _emit_results(_emit_id, msg)
            except Exception:
                pass
except ImportError:

    def _note(msg):
        pass

    def _status(msg):
        pass

    def _results(msg):
        pass


def _safe_json(obj):
    try:
        return json.dumps(obj, indent=2, ensure_ascii=False)
    except Exception:
        return "[unserializable]"


def _sanitize_result(tool_name, value):
    name = str(tool_name or "").lower()
    if "read" in name or name in ("cat", "view"):
        try:
            n = len(value) if isinstance(value, str) else len(json.dumps(value))
        except Exception:
            n = 0
        return f"[redacted read/file contents · {n} chars]"
    if isinstance(value, str) and len(value) > 12000:
        return value[:12000] + f"\n[truncated · {len(value)} chars total]"
    return value


def _usage_from_message(msg):
    usage = msg.get("usage") or {}
    cost_obj = usage.get("cost") or {}
    return {
        "input": usage.get("input") or usage.get("prompt_tokens") or 0,
        "output": usage.get("output") or usage.get("completion_tokens") or 0,
        "total": usage.get("totalTokens") or usage.get("total_tokens") or 0,
        "cost": cost_obj.get("total") or usage.get("cost_usd") or 0,
    }


def _runtime_dispatches_dir():
    return os.path.join(
        os.environ.get("KOAD_IO_RUNTIME_PATH", os.path.expanduser("~/.local/share/koad-io/runtime")),
        "dispatches",
    )


def _dispatch_json_path(flight_id):
    return os.path.join(_runtime_dispatches_dir(), flight_id, "dispatch.json")


def _run_jsonl_path(flight_id):
    return os.path.join(_runtime_dispatches_dir(), flight_id, "run.jsonl")


def _update_flight_stats(stats, model_id=None):
    flight_id = os.environ.get("HARNESS_CONTROL_FLIGHT_ID", "")
    if not flight_id:
        return
    dispatch_file = _dispatch_json_path(flight_id)
    if not os.path.exists(dispatch_file):
        return
    try:
        with open(dispatch_file, "r") as f:
            rec = json.load(f)
        rec["stats"] = rec.get("stats") or {}
        rec["stats"].update({
            "turns": stats.get("turns", 0),
            "toolCalls": stats.get("toolCalls", 0),
            "inputTokens": stats.get("inputTokens", 0) or None,
            "outputTokens": stats.get("outputTokens", 0) or None,
            "cost": stats.get("cost", 0),
        })
        if model_id:
            rec["model"] = model_id
        tmp = dispatch_file + ".tmp." + str(os.getpid())
        with open(tmp, "w") as f:
            json.dump(rec, f, indent=2)
            f.write("\n")
        os.replace(tmp, dispatch_file)
    except Exception:
        pass


def _merge_dispatch_control(path, patch):
    if not path:
        return
    try:
        payload = {}
        if os.path.exists(path):
            with open(path, "r") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    payload = loaded
        payload.update({k: v for k, v in patch.items() if v is not None})
        tmp = path + ".tmp." + str(os.getpid())
        with open(tmp, "w") as f:
            json.dump(payload, f)
        os.replace(tmp, path)
    except OSError:
        pass





def _summary_from_text(text):
    if not text:
        return None
    lines = [" ".join(str(line).split()) for line in str(text).splitlines()]
    lines = [line for line in lines if line and line not in ("```", "---")]
    if not lines:
        return None
    summary = lines[0]
    return summary[:300]


def _record_touched_paths(tool_name, args, files_touched):
    if not isinstance(args, dict):
        return
    name = str(tool_name or "").lower()
    path_keys = []
    if name in ("write", "edit", "rm", "chmod", "mkdir"):
        path_keys = ["path"]
    elif name in ("mv", "cp"):
        path_keys = ["src", "dst"]

    for key in path_keys:
        value = args.get(key)
        if isinstance(value, str) and value:
            files_touched.add(value)


def _persist_dispatch_result(dispatch_control_file, final_text, streamed_assistant_text, stats, latest_model, files_touched):
    final_body = final_text or streamed_assistant_text or None
    summary = _summary_from_text(final_body)
    completed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    touched = sorted(files_touched)
    total_tokens = (stats.get("inputTokens", 0) or 0) + (stats.get("outputTokens", 0) or 0)

    _merge_dispatch_control(dispatch_control_file, {
        "completedAt": completed_at,
        "resultSummary": summary,
        "finalAssistantText": final_body,
        "filesTouched": touched,
        "model": latest_model,
        "stats": {
            "turns": stats.get("turns", 0),
            "toolCalls": stats.get("toolCalls", 0),
            "inputTokens": stats.get("inputTokens", 0),
            "outputTokens": stats.get("outputTokens", 0),
            "cost": stats.get("cost", 0),
        },
    })

    flight_id = os.environ.get("HARNESS_CONTROL_FLIGHT_ID", "")
    if not flight_id:
        return

    # Append a close snapshot to run.jsonl in the dispatch dir.
    # The harness fallback and control-tower both read this file.
    run_jsonl = _run_jsonl_path(flight_id)
    close_snapshot = {
        "run_id": os.environ.get("HARNESS_RUN_RECORD", ""),
        "flight_id": flight_id,
        "entity": os.environ.get("ENTITY", ""),
        "status": "complete",
        "ended": completed_at,
        "completed_at": completed_at,
        "close_reason": "pi-rpc-dispatch",
        "close_verified": True,
        "outputs": {
            "summary": summary,
            "final_text": final_body,
            "files_touched": touched,
        },
        "results": {
            "success": True,
            "tokens_used": total_tokens,
            "cost": stats.get("cost", 0),
        },
        "stats": {
            "turns": stats.get("turns", 0),
            "toolCalls": stats.get("toolCalls", 0),
            "inputTokens": stats.get("inputTokens", 0),
            "outputTokens": stats.get("outputTokens", 0),
            "cost": stats.get("cost", 0),
        },
        "snapshot_at": completed_at,
    }
    if latest_model:
        close_snapshot["model"] = latest_model
    if total_tokens:
        close_snapshot["elapsed_tokens"] = total_tokens

    try:
        os.makedirs(os.path.dirname(run_jsonl), exist_ok=True)
        with open(run_jsonl, "a") as f:
            f.write(json.dumps(close_snapshot) + "\n")
    except OSError:
        pass


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
    streamed_assistant_text = ""
    running_log = ""
    stats = {"turns": 0, "toolCalls": 0, "inputTokens": 0, "outputTokens": 0, "cost": 0.0}
    latest_model = None
    files_touched = set()

    def append_log(text):
        nonlocal running_log
        running_log += text + "\n"
        _results(running_log[-50000:])

    def reader():
        nonlocal session_file, final_text, streamed_assistant_text, latest_model, files_touched
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
                        _merge_dispatch_control(dispatch_control_file, payload)
                elif cmd_name == "get_last_assistant_text" and ev.get("success"):
                    final_text = (ev.get("data") or {}).get("text")
                continue

            elif ev_type == "message_start":
                msg = ev.get("message") or {}
                if msg.get("role") == "assistant":
                    streamed_assistant_text = ""

            elif ev_type == "message_update":
                msg = ev.get("message") or {}
                if msg.get("role") == "assistant":
                    content = msg.get("content") or []
                    full_text = "".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
                    chunk = full_text[len(streamed_assistant_text):] if full_text.startswith(streamed_assistant_text) else full_text
                    streamed_assistant_text = full_text
                    if chunk:
                        append_log(chunk)

            elif ev_type == "tool_execution_start":
                tool_name = ev.get("toolName", "?")
                args = ev.get("args") or {}
                _record_touched_paths(tool_name, args, files_touched)
                stats["toolCalls"] += 1
                args_summary = _safe_json(args)
                if len(args_summary) > 800:
                    args_summary = args_summary[:800] + "…"
                append_log(f"\n### TOOL CALL {stats['toolCalls']}: {tool_name}\n```json\n{_safe_json(args)}\n```")
                _note(f"→ {tool_name} #{stats['toolCalls']}\n```json\n{args_summary}\n```")
                _status(f"tool: {tool_name}")
                _update_flight_stats(stats, latest_model)

            elif ev_type == "tool_execution_end":
                tool_name = ev.get("toolName", "?")
                is_error = ev.get("isError", False)
                result = _sanitize_result(tool_name, ev.get("result")) if "result" in ev else None
                result_summary = ""
                if result is not None:
                    result_summary = _safe_json(result)
                    if len(result_summary) > 800:
                        result_summary = result_summary[:800] + "…"
                    result_summary = f"\n```json\n{result_summary}\n```"
                append_log(f"\n### TOOL RESULT: {tool_name} {'ERROR' if is_error else 'ok'}" + (f"\n```json\n{_safe_json(result)}\n```" if result is not None else ""))
                _note(f"← {tool_name} {'ERROR' if is_error else 'ok'}{result_summary}")

            elif ev_type in ("turn_end", "message_end"):
                msg_data = ev.get("message") or {}
                if msg_data.get("role") and msg_data.get("role") != "assistant":
                    continue
                usage_delta = _usage_from_message(msg_data)
                stats["turns"] += 1
                stats["inputTokens"] += usage_delta["input"]
                stats["outputTokens"] += usage_delta["output"]
                stats["cost"] += usage_delta["cost"]
                model_info = msg_data.get("model") or {}
                model_id = model_info.get("id") if isinstance(model_info, dict) else (model_info or None)
                latest_model = model_id or latest_model
                append_log(
                    f"\n### TURN {stats['turns']} COMPLETE"
                    f"\nmodel: {latest_model or '—'}"
                    f"\ntokens: in={usage_delta['input']} out={usage_delta['output']} total={usage_delta['total']}"
                    f"\ncost: ${usage_delta['cost']:.6f}"
                    f"\nrunning cost: ${stats['cost']:.6f}"
                    f"\n\nraw message:\n```json\n{_safe_json(msg_data)}\n```"
                )
                _note(f"turn {stats['turns']}: in={usage_delta['input']} out={usage_delta['output']} ${usage_delta['cost']:.6f} (total ${stats['cost']:.6f}) — {latest_model or 'model?'}")
                _update_flight_stats(stats, latest_model)

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
        append_log("\n### FINAL ASSISTANT TEXT\n" + final_text)

    _persist_dispatch_result(
        dispatch_control_file,
        final_text,
        streamed_assistant_text,
        stats,
        latest_model,
        files_touched,
    )

    _update_flight_stats(stats, latest_model)

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
        entity = os.environ.get("ENTITY", "")
        if entity:
            entity_home = os.path.join(os.environ.get("HOME", "/home"), "." + entity.lower())
            entity_slug = "--" + entity_home.lstrip("/").replace("/", "-") + "--"
            sess_dir = os.path.join(pi_dir, "sessions", entity_slug)
            if os.path.isdir(sess_dir):
                try:
                    files = sorted(os.listdir(sess_dir), reverse=True)
                    if files:
                        session_file = os.path.join(sess_dir, files[0])
                except OSError:
                    pass
        if session_file:
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
            _merge_dispatch_control(dispatch_control_file, payload)

    if rc == 120 and agent_done.is_set():
        rc = 0

    sys.exit(rc)


if __name__ == "__main__":
    main()
