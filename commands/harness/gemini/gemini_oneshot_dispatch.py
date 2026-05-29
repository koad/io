#!/usr/bin/env python3
"""Gemini one-shot dispatch — launch gemini CLI, stream events, capture output.

Usage: gemini_oneshot_dispatch.py <gemini_bin> [flags...]

Reads PROMPT and HARNESS_EMISSION_ID from environment.
Streams JSON events from gemini, emits tool-use notes, and collects
message content. Prints assembled text to stdout on completion.
"""

import json
import os
import subprocess
import sys

_sys_emit_path = os.path.expanduser("~/.koad-io/helpers")
if _sys_emit_path not in sys.path:
    sys.path.insert(0, _sys_emit_path)
_emit_id = os.environ.get("HARNESS_EMISSION_ID", "")
try:
    from emit import emit_note as _en, emit_status as _es

    def _note(msg):
        if _emit_id:
            try:
                _en(_emit_id, msg)
            except Exception:
                pass

    def _status(msg):
        if _emit_id:
            try:
                _es(_emit_id, msg)
            except Exception:
                pass
except ImportError:

    def _note(msg):
        pass

    def _status(msg):
        pass


def _args_brief(params):
    if not isinstance(params, dict) or not params:
        return ""
    parts = [f"{k}={str(v)[:40]}" for k, v in list(params.items())[:3]]
    s = ", ".join(parts)
    if len(params) > 3:
        s += f" …+{len(params)-3}"
    return f": {s}"


if __name__ == "__main__":
    gemini_bin = sys.argv[1]
    flags = sys.argv[2:]
    prompt = os.environ.get("PROMPT", "")

    cmd = [gemini_bin, "-p", prompt] + flags
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=sys.stderr, text=True, bufsize=1
    )

    text_parts = []
    for raw in proc.stdout:
        line = raw.rstrip("\r\n")
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            print(line, flush=True)
            continue
        t = ev.get("type", "")
        if t == "message":
            content = ev.get("content", "")
            if content:
                text_parts.append(content)
        elif t == "tool_use":
            name = ev.get("tool_name", "?")
            brief = _args_brief(ev.get("parameters") or {})
            _note(f"→ {name}{brief}")
            _status(f"tool: {name}")
        elif t == "tool_result":
            status_val = ev.get("status", "?")
            _note(f"← {status_val}")
        elif t == "result":
            stats = ev.get("stats") or {}
            tokens = stats.get("totalTokens")
            if tokens:
                _note(f"done: {tokens} tokens")
        elif t == "error":
            msg = ev.get("message", "")
            sev = ev.get("severity", "error")
            if msg:
                _note(f"{sev}: {msg[:100]}")

    proc.wait()
    if text_parts:
        print("".join(text_parts), flush=True)
    sys.exit(proc.returncode or 0)
