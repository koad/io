#!/usr/bin/env python3
"""Capture codex session UUID from sqlite after one-shot exec.

Reads _DISPATCH_CONTROL_FILE and _session_start_ts from environment.
Queries ~/.codex/logs_2.sqlite for the process_uuid written during the run.
Updates dispatch-control.json with the captured UUID.
"""

import json
import os
import sqlite3
import time

fc = os.environ.get("_DISPATCH_CONTROL_FILE", "")
start_ts = int(os.environ.get("_session_start_ts", "0") or "0")
db_path = os.path.expanduser("~/.codex/logs_2.sqlite")

process_uuid = None
if os.path.exists(db_path) and start_ts > 0:
    try:
        con = sqlite3.connect(db_path)
        row = con.execute(
            "SELECT process_uuid FROM logs WHERE ts_nanos >= ? AND process_uuid IS NOT NULL LIMIT 1",
            (start_ts,),
        ).fetchone()
        if row:
            process_uuid = row[0]
        con.close()
    except Exception:
        pass

if fc and os.path.exists(fc):
    try:
        with open(fc) as f:
            payload = json.load(f)
    except Exception:
        payload = {}
    payload["codexProcessUuid"] = process_uuid
    payload["capturedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tmp = fc + ".tmp." + str(os.getpid())
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, fc)
