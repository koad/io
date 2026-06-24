/**
 * Bond-gated `browse` tool — wraps CDP browser control for entities.
 *
 * Talks Chrome DevTools Protocol directly via HTTP fetch() + WebSocket.
 * No bash, no curl, no external process. The browser is managed by the
 * `koad-io browse` command (bash) or the control-tower `/browse` endpoint;
 * this tool talks CDP on the debug port after the browser is running.
 *
 * Modes: start, navigate, eval, tabs, screenshot, doctor.
 * Gated by `koadio_tools` bond grant ("browse").
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

const HOME = os.homedir();
const BIND_IP = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
const CTRL_PORT = process.env.KOAD_IO_CONTROL_PORT ?? "28283";
const CTRL_URL = process.env.KOAD_IO_CONTROL_URL ?? `http://${BIND_IP}:${CTRL_PORT}`;

const DEFAULT_PORT = 9222;
const DEFAULT_WAIT_MS = 40_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_EVAL_MS = 120_000;

// ── Port discovery ───────────────────────────────────────────────────────────

function discoverPort(): number {
  // 1. Explicit env override
  if (process.env.KOAD_IO_BROWSE_PORT) {
    const p = parseInt(process.env.KOAD_IO_BROWSE_PORT, 10);
    if (!isNaN(p) && p > 0) return p;
  }

  // 2. Port file: $KOAD_IO_RUNTIME_PATH/browse/<entity>.port
  const entity = process.env.ENTITY ?? "";
  if (entity) {
    const runtimePath = process.env.KOAD_IO_RUNTIME_PATH || path.join(HOME, ".local", "share", "koad-io", "runtime");
    const portFile = path.join(runtimePath, "browse", `${entity}.port`);
    try {
      const raw = fs.readFileSync(portFile, "utf-8").trim();
      const p = parseInt(raw, 10);
      if (!isNaN(p) && p > 0) return p;
    } catch (_) { /* not found */ }
  }

  // 3. Default
  return DEFAULT_PORT;
}

function cdpUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

// ── CDP helpers ──────────────────────────────────────────────────────────────

interface CdpTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string;
}

let _rpcId = 0;

function rpc(ws: WebSocket, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++_rpcId;
    const onMsg = (ev: MessageEvent) => {
      const m = JSON.parse(ev.data as string);
      if (m.id === id) {
        ws.removeEventListener("message", onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function getTargets(port: number): Promise<CdpTarget[]> {
  const res = await fetch(`${cdpUrl(port)}/json`);
  if (!res.ok) throw new Error(`CDP /json returned ${res.status}`);
  const targets = (await res.json()) as any[];
  return targets
    .filter((t: any) => t.type === "page")
    .map((t: any) => ({
      id: t.id ?? "",
      title: t.title ?? "",
      url: t.url ?? "",
      type: t.type ?? "",
      webSocketDebuggerUrl: t.webSocketDebuggerUrl ?? "",
    }));
}

function pickPage(targets: CdpTarget[], fragment?: string): CdpTarget {
  if (!fragment) return targets[0];
  const lower = fragment.toLowerCase();
  const match = targets.find(
    (t) =>
      (t.url || "").toLowerCase().includes(lower) ||
      (t.title || "").toLowerCase().includes(lower) ||
      (t.id || "").toLowerCase().includes(lower),
  );
  return match ?? targets[0];
}

async function evalInPage(
  ws: WebSocket,
  expression: string,
  awaitPromise = true,
): Promise<unknown> {
  const result = (await rpc(ws, "Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    timeout: MAX_EVAL_MS,
  })) as any;

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text ?? result.exceptionDetails.exception?.description ?? "Runtime exception";
    throw new Error(`Page exception: ${text}`);
  }
  return result.result?.value;
}

async function connectToPage(target: CdpTarget): Promise<WebSocket> {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection error"));
    }, { once: true });
  });
  return ws;
}

// ── Mode: tabs ───────────────────────────────────────────────────────────────

async function doTabs(port: number, page?: string) {
  const targets = await getTargets(port);
  if (!targets.length) return { content: "No page targets found.", details: { targets: [] } };

  // Mark the active page
  const active = page ? pickPage(targets, page) : targets[0];
  const list = targets.map((t, i) => ({
    index: i,
    id: t.id,
    title: t.title || "(untitled)",
    url: t.url || "(no url)",
    active: t.id === active.id,
  }));

  const lines = list.map((t) => {
    const marker = t.active ? " ▶" : "  ";
    return `${marker}[${t.index}] ${t.title}\n    url: ${t.url}\n    id:  ${t.id}`;
  });

  return {
    content: `${targets.length} tab(s):\n\n${lines.join("\n\n")}`,
    details: { count: targets.length, targets: list },
  };
}

// ── Mode: navigate ───────────────────────────────────────────────────────────

async function doNavigate(
  port: number,
  url: string,
  waitExpr?: string,
  waitMs: number = DEFAULT_WAIT_MS,
  page?: string,
) {
  const targets = await getTargets(port);
  if (!targets.length) throw new Error("No page targets — is the browser open?");
  const target = pickPage(targets, page);

  const ws = await connectToPage(target);
  try {
    await rpc(ws, "Page.enable");
    await rpc(ws, "Page.navigate", { url });

    // Wait for readiness if expression given
    let ready = true;
    if (waitExpr) {
      await rpc(ws, "Runtime.enable");
      const deadline = Date.now() + waitMs;
      ready = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const val = await evalInPage(ws, waitExpr, false);
          if (val === true) {
            ready = true;
            break;
          }
        } catch (_) { /* keep polling */ }
      }
    }

    // Read page state
    await rpc(ws, "Runtime.enable");
    let state: any = {};
    try {
      state = await evalInPage(ws, `(() => ({
        title: document.title,
        url: location.href,
        readyState: document.readyState,
      }))()`);
    } catch (_) { /* best-effort */ }

    return {
      content: ready
        ? `✓ navigated to ${url}\n  title: ${state?.title ?? target.title}\n  readyState: ${state?.readyState ?? "?"}`
        : `⚠ navigated to ${url} but wait condition not met within ${waitMs}ms\n  title: ${state?.title ?? target.title}\n  readyState: ${state?.readyState ?? "?"}`,
      details: { url, ready, state, pageId: target.id },
    };
  } finally {
    ws.close();
  }
}

// ── Mode: eval ───────────────────────────────────────────────────────────────

async function doEval(port: number, js: string, page?: string) {
  const targets = await getTargets(port);
  if (!targets.length) throw new Error("No page targets — is the browser open?");
  const target = pickPage(targets, page);

  const ws = await connectToPage(target);
  try {
    await rpc(ws, "Runtime.enable");

    // Wrap: multi-statement vs single expression
    const isMulti = js.includes(";");
    const wrapped = isMulti
      ? `(async () => { ${js} })()`
      : `(async () => { return (${js}); })()`;

    const value = await evalInPage(ws, wrapped, true);
    const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2);

    // Truncate very long results
    const maxLen = 20_000;
    const display = rendered.length > maxLen
      ? rendered.slice(0, maxLen) + `\n\n… truncated (${rendered.length - maxLen} more chars)`
      : rendered;

    return {
      content: display,
      details: { value, pageId: target.id, pageUrl: target.url },
    };
  } finally {
    ws.close();
  }
}

// ── Mode: screenshot ─────────────────────────────────────────────────────────

async function doScreenshot(port: number, full: boolean, page?: string, navigate?: string) {
  const targets = await getTargets(port);
  if (!targets.length) throw new Error("No page targets — is the browser open?");
  const target = pickPage(targets, page);

  const ws = await connectToPage(target);
  try {
    await rpc(ws, "Page.enable");

    if (navigate) {
      await rpc(ws, "Page.navigate", { url: navigate });
      await new Promise((r) => setTimeout(r, 4000));
    }

    const result = (await rpc(ws, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: full,
    })) as any;

    const outFile = `/tmp/cdp-screenshot-${Date.now()}.png`;
    fs.writeFileSync(outFile, Buffer.from(result.data, "base64"));

    return {
      content: `✓ screenshot saved to ${outFile}`,
      details: { file: outFile, pageId: target.id, pageUrl: target.url, full },
    };
  } finally {
    ws.close();
  }
}

// ── Mode: doctor ─────────────────────────────────────────────────────────────

async function doDoctor(port: number, page?: string, navigate?: string, timeoutMs = 4000) {
  const targets = await getTargets(port);
  if (!targets.length) throw new Error("No page targets — is the browser open?");
  const target = pickPage(targets, page);

  const ws = await connectToPage(target);
  try {
    await rpc(ws, "Runtime.enable");
    await rpc(ws, "Page.enable");

    if (navigate) {
      await rpc(ws, "Page.navigate", { url: navigate });
    }

    // Page state
    let state: any = {};
    try {
      state = await evalInPage(ws, `(() => ({
        href: location?.href || null,
        title: document?.title || null,
        readyState: document?.readyState || null,
        visibilityState: document?.visibilityState || null,
        hasBody: !!document?.body,
      }))()`);
    } catch (_) { /* best-effort */ }

    // Meteor probe
    let meteor: any = null;
    try {
      meteor = await evalInPage(ws, `(() => {
        const M = globalThis.Meteor;
        if (!M || typeof M.status !== 'function') return null;
        try {
          const s = M.status();
          return { connected: !!s.connected, status: s.status ?? null, retryCount: s.retryCount ?? null, reason: s.reason ?? null };
        } catch (e) { return { error: String(e) }; }
      })()`);
    } catch (_) { /* best-effort */ }

    // Collect console warnings/errors
    const consoleEntries: { level: string; text: string; ts: number }[] = [];
    const failedRequests: { type: string; errorText: string; url: string }[] = [];

    // Listen for console + network events
    const requestUrlById = new Map<string, string>();
    await rpc(ws, "Log.enable").catch(() => null);
    await rpc(ws, "Network.enable");

    const eventHandler = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.id || !msg.method) return;

      if (msg.method === "Runtime.consoleAPICalled") {
        const params = msg.params || {};
        const level = params.type || "log";
        if (["warning", "error"].includes(level)) {
          const text = (params.args || [])
            .map((arg: any) => (arg.value !== undefined ? String(arg.value) : arg.description ?? ""))
            .join(" ");
          consoleEntries.push({ level, text, ts: Date.now() });
        }
      } else if (msg.method === "Network.requestWillBeSent") {
        const params = msg.params || {};
        if (params.requestId && params.request?.url) {
          requestUrlById.set(params.requestId, params.request.url);
        }
      } else if (msg.method === "Network.loadingFailed") {
        const params = msg.params || {};
        failedRequests.push({
          type: params.type || "",
          errorText: params.errorText || "",
          url: requestUrlById.get(params.requestId) || "",
        });
      }
    };

    ws.addEventListener("message", eventHandler);

    // Wait for the observation window
    await new Promise((r) => setTimeout(r, timeoutMs));

    ws.removeEventListener("message", eventHandler);

    // Build report
    const lines: string[] = [];
    lines.push(`page:         ${state?.title || target.title || "(untitled)"}`);
    lines.push(`url:          ${state?.href || target.url || "(no url)"}`);
    lines.push(`readyState:   ${state?.readyState || "unknown"}`);
    lines.push(`visibility:   ${state?.visibilityState || "unknown"}`);

    if (meteor?.error) {
      lines.push(`Meteor:       ERROR — ${meteor.error}`);
    } else if (meteor?.connected) {
      lines.push("Meteor:       connected");
    } else if (meteor) {
      lines.push(`Meteor:       ${meteor.status || "present but not connected"}`);
    } else {
      lines.push("Meteor:       not present");
    }

    lines.push(`window:       ${timeoutMs}ms`);
    lines.push(`console:      ${consoleEntries.length} warnings/errors`);
    lines.push(`failed net:   ${failedRequests.length}`);

    if (consoleEntries.length) {
      lines.push("\nconsole warnings/errors:");
      for (const e of consoleEntries) {
        lines.push(`- [${e.level}] ${e.text}`);
      }
    }

    if (failedRequests.length) {
      lines.push("\nnetwork failures:");
      for (const f of failedRequests) {
        lines.push(`- ${f.type || "request"} ${f.errorText}`);
        if (f.url) lines.push(`  ${f.url}`);
      }
    }

    return {
      content: lines.join("\n"),
      details: {
        state,
        meteor,
        consoleEntries,
        failedRequests,
        windowMs: timeoutMs,
        pageId: target.id,
      },
    };
  } finally {
    ws.close();
  }
}

// ── Mode: start ──────────────────────────────────────────────────────────────

async function doStart(): Promise<{ content: string; details: Record<string, unknown> }> {
  const entity = process.env.ENTITY ?? "";
  // Call control-tower browse endpoint to launch the browser
  try {
    const res = await fetch(`${CTRL_URL}/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity }),
    });
    const data = (await res.json()) as any;
    if (data?.ok) {
      return {
        content: `✓ browser started for ${entity}\n  port: ${data.port}\n  CDP: http://127.0.0.1:${data.port}/json`,
        details: { entity, port: data.port, cdp: data.cdp, screen: data.screen },
      };
    }
    throw new Error(data?.error || `control-tower returned status ${res.status}`);
  } catch (err: any) {
    // If control-tower is unreachable, try to discover and report
    const port = discoverPort();
    try {
      await getTargets(port);
      return {
        content: `✓ browser already running on port ${port}\n  CDP: http://127.0.0.1:${port}/json`,
        details: { port, alreadyRunning: true },
      };
    } catch (_) {
      throw new Error(
        `Could not start or connect to browser. Control-tower: ${err.message}. ` +
        `Also tried port ${port} — no CDP response. Ensure the browser is running or control-tower is accessible.`,
      );
    }
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerBrowseTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browse",
    label: "Browse",
    description: [
      "Browser control via Chrome DevTools Protocol — talks CDP directly.",
      "Modes: start (launch browser), navigate (go to URL + optional wait),",
      "eval (execute JS in page), tabs (list open tabs), screenshot (capture PNG),",
      "doctor (diagnostic snapshot: page state, Meteor status, console errors).",
      "No bash — all CDP communication is HTTP + WebSocket from Node.js.",
      "Bond-gated: entity needs \"browse\" in their koadio_tools list.",
    ].join("\n"),
    promptSnippet: "Browse (mode: start|navigate|eval|tabs|screenshot|doctor, url?, js?)",
    promptGuidelines: [
      "Use browse start to launch the entity's browser.",
      "Use browse tabs to see what pages are open.",
      "Use browse navigate to go to a URL, optionally wait for a JS condition.",
      "Use browse eval to run JS on a page — this IS the jQuery/inspection tool.",
      "Use browse screenshot to capture a PNG.",
      "Use browse doctor for a diagnostic snapshot of the page.",
      "The browser persists across calls — navigate once, then eval multiple times.",
    ],
    parameters: Type.Object({
      mode: Type.String({
        description: "Action: start, navigate, eval, tabs, screenshot, doctor.",
      }),
      url: Type.Optional(Type.String({
        description: "URL for navigate mode, or navigate-to in screenshot/doctor.",
      })),
      wait: Type.Optional(Type.String({
        description: "JS expression to poll until truthy after navigate. E.g. 'typeof Meteor !== \"undefined\"'.",
      })),
      wait_ms: Type.Optional(Type.Number({
        description: "Max ms to wait for wait condition. Default: 40000.",
        default: DEFAULT_WAIT_MS,
      })),
      js: Type.Optional(Type.String({
        description: "JavaScript expression to evaluate in the page (eval mode). Multi-statement with semicolons OK.",
      })),
      page: Type.Optional(Type.String({
        description: "URL/title fragment to target a specific page tab.",
      })),
      full: Type.Optional(Type.Boolean({
        description: "Capture full page screenshot (beyond viewport). Default: false.",
      })),
      port: Type.Optional(Type.Number({
        description: "CDP debug port override. Auto-discovered if omitted.",
      })),
    }),

    renderCall(args: any, theme: any) {
      const mode = args?.mode ?? "?";
      const extra = args?.url
        ? ` ${String(args.url).slice(0, 50)}`
        : args?.js
          ? ` ${String(args.js).slice(0, 50)}`
          : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("browse ")) +
        theme.fg("accent", `${mode}${extra}`),
        0,
        0,
      );
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      if (!ok) {
        const details = (result?.details ?? {}) as Record<string, any>;
        return new Text(
          theme.fg("error", `✗ browse: ${details?.error ?? "failed"}`),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("success", "✓ browse complete"),
        0,
        0,
      );
    },

    async execute(_toolCallId, params) {
      const mode = String(params.mode ?? "").trim();
      if (!mode) throw new Error("browse: mode is required (start, navigate, eval, tabs, screenshot, doctor)");

      const port = params.port != null ? Number(params.port) : discoverPort();

      switch (mode) {
        case "start":
          return await doStart();

        case "tabs":
          return await doTabs(port, params.page as string | undefined);

        case "navigate": {
          const url = String(params.url ?? "").trim();
          if (!url) throw new Error("browse navigate: url is required");
          return await doNavigate(
            port,
            url,
            params.wait as string | undefined,
            (params.wait_ms as number) ?? DEFAULT_WAIT_MS,
            params.page as string | undefined,
          );
        }

        case "eval": {
          const js = String(params.js ?? "").trim();
          if (!js) throw new Error("browse eval: js expression is required");
          return await doEval(port, js, params.page as string | undefined);
        }

        case "screenshot":
          return await doScreenshot(
            port,
            !!(params.full),
            params.page as string | undefined,
            params.url as string | undefined,
          );

        case "doctor":
          return await doDoctor(
            port,
            params.page as string | undefined,
            params.url as string | undefined,
            (params.wait_ms as number) ?? DEFAULT_TIMEOUT_MS,
          );

        default:
          throw new Error(
            `Unknown browse mode: ${mode}. Valid: start, navigate, eval, tabs, screenshot, doctor.`,
          );
      }
    },
  });
}
