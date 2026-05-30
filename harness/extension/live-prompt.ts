import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";

const LOG = `${os.homedir()}/.koad-io/harness/debug.log`;
const _BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const _DAEMON_URL = process.env.KOAD_IO_DAEMON_URL ?? `http://${_BIND_IP}:${process.env.KOAD_IO_PORT ?? "28282"}`;
const URL = `${_DAEMON_URL}/api/prompt/live`;
const ENTITY = process.env.ENTITY ?? "";
const SESSION = process.env.HARNESS_SESSION_ID ?? "";

function log(msg: string) {
  const ts = new Date().toISOString();
  try { fs.appendFileSync(LOG, `[${ts}] [live-prompt] ${msg}\n`); } catch (_) {}
}

export function startLivePrompt(pi: ExtensionAPI): void {
  log(`started — entity=${ENTITY} session=${SESSION} url=${URL}`);

  let lastText = "";

  pi.on("input", (event, _ctx) => {
    const raw = event.text || "";
    const src = event.source || "?";
    const text = raw.trim().slice(0, 500);
    if (!text || text === lastText) return { action: "continue" };
    lastText = text;
    log(`input source=${src} len=${raw.length} text="${text.slice(0, 80)}"`);

    fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity: ENTITY, session_id: SESSION, text, at: new Date().toISOString() }),
    }).then(r => log(`fetch OK status=${r.status}`)).catch(e => log(`fetch ERR: ${e.message || e}`));

    return { action: "continue" };
  });
}
