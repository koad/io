/**
 * Bond-gated `fetch` tool — HTTP requests via Node.js built-in fetch().
 *
 * No bash, no curl, no external process. Runs entirely in the extension's
 * Node.js sandbox. Gated by `koadio_tools` bond grant ("fetch").
 *
 * Use case: entities like Sibyl need web access for research, source
 * vetting, and documentation reads but cannot have bash/curl.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 50_000; // 50KB

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateBody(text: string): { body: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= MAX_BODY_BYTES) return { body: text, truncated: false };
  // Truncate at byte boundary
  const truncated = buf.subarray(0, MAX_BODY_BYTES).toString("utf-8");
  return { body: truncated, truncated: true };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function classifyError(err: unknown): { message: string; code: string } {
  if (err instanceof Error) {
    const msg = err.message || String(err);
    // Node.js fetch errors have `.cause` with the underlying system error
    const cause = (err as any).cause;
    const code = cause?.code ?? (err as any).code ?? "";

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return { message: `DNS lookup failed: ${msg}`, code: "dns_failure" };
    }
    if (code === "ECONNREFUSED") {
      return { message: `Connection refused: ${msg}`, code: "connection_refused" };
    }
    if (code === "ECONNRESET") {
      return { message: `Connection reset: ${msg}`, code: "connection_reset" };
    }
    if (code === "ETIMEDOUT" || msg.includes("timed out") || msg.includes("aborted")) {
      return { message: `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`, code: "timeout" };
    }
    if (code === "CERT_HAS_EXPIRED" || msg.includes("certificate")) {
      return { message: `TLS error: ${msg}`, code: "tls_error" };
    }
    return { message: msg, code: code || "fetch_error" };
  }
  return { message: String(err), code: "fetch_error" };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerFetchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fetch",
    label: "Fetch URL",
    description: [
      "Fetch a URL via HTTP. Uses Node.js built-in fetch() — no bash, no curl.",
      "Returns status, headers, and truncated body (50KB max).",
      "GET by default. Set method, headers, and body for other request types.",
      "15-second timeout. Read-only by default — no file writes.",
      "Bond-gated: entity needs \"fetch\" in their koadio_tools list.",
    ].join("\n"),
    promptSnippet: "Fetch a URL (GET by default, 15s timeout, 50KB body limit)",
    promptGuidelines: [
      "Use fetch for HTTP GET requests to read web pages, APIs, and documentation.",
      "Pass optional method, headers, and body for POST/PUT/etc.",
      "Body is truncated at 50KB — use truncated flag to detect incomplete responses.",
      "Errors return clean error objects with code field — never crash.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch." }),
      method: Type.Optional(Type.String({
        description: "HTTP method. Default: GET.",
        default: "GET",
      })),
      headers: Type.Optional(Type.Record(Type.String(), Type.String(), {
        description: "Request headers as key-value pairs.",
      })),
      body: Type.Optional(Type.String({
        description: "Request body (for POST, PUT, etc.).",
      })),
    }),

    renderCall(args: any, theme: any) {
      const method = (args?.method ?? "GET").toString().toUpperCase();
      const url = (args?.url ?? "").toString();
      // Truncate URL for display
      const displayUrl = url.length > 60 ? url.slice(0, 57) + "..." : url;
      return new Text(
        theme.fg("toolTitle", theme.bold("fetch ")) +
        theme.fg("accent", `${method} `) +
        theme.fg("dim", displayUrl),
        0,
        0,
      );
    },

    renderResult(result: any, _opts: any, theme: any) {
      const ok = !result?.isError;
      if (!ok) {
        const details = (result?.details ?? {}) as Record<string, any>;
        return new Text(
          theme.fg("error", `✗ fetch failed: ${details?.code ?? "error"}`),
          0,
          0,
        );
      }
      const details = (result?.details ?? {}) as Record<string, any>;
      const status = details?.status ?? "?";
      const truncated = details?.truncated ? " (truncated)" : "";
      return new Text(
        theme.fg("success", `✓ HTTP ${status}${truncated}`),
        0,
        0,
      );
    },

    async execute(_toolCallId, params) {
      const url = String(params.url ?? "").trim();
      if (!url) throw new Error("fetch: url is required");

      const method = (params.method?.toString().toUpperCase() ?? "GET") || "GET";
      const reqHeaders: Record<string, string> = (params.headers ?? {}) as Record<string, string>;
      const reqBody = params.body != null ? String(params.body) : undefined;

      // Build fetch init
      const init: RequestInit = {
        method,
        headers: reqHeaders,
        redirect: "follow",
      };
      if (reqBody != null && method !== "GET" && method !== "HEAD") {
        init.body = reqBody;
      }

      // Setup timeout via AbortController
      const controller = new AbortController();
      init.signal = controller.signal;
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        clearTimeout(timeout);
        const { message, code } = classifyError(err);
        return {
          content: [{ type: "text", text: `fetch error [${code}]: ${message}` }],
          details: { code, error: message },
          isError: true,
        };
      } finally {
        clearTimeout(timeout);
      }

      // Read response body
      let rawBody: string;
      try {
        rawBody = await response.text();
      } catch (err) {
        return {
          content: [{ type: "text", text: `fetch: failed to read response body: ${err instanceof Error ? err.message : String(err)}` }],
          details: { status: response.status, statusText: response.statusText, code: "body_read_error" },
          isError: true,
        };
      }

      const { body, truncated } = truncateBody(rawBody);
      const respHeaders = headersToRecord(response.headers);

      // Build content summary
      const lines: string[] = [
        `HTTP ${response.status} ${response.statusText}`,
        `URL: ${url}`,
      ];
      if (truncated) {
        lines.push(`Body truncated at ${MAX_BODY_BYTES / 1000}KB (full size: ${Buffer.byteLength(rawBody, "utf-8")} bytes)`);
      }
      // Include a few key headers
      const keyHeaders = ["content-type", "content-length", "server", "date", "location"];
      for (const key of keyHeaders) {
        const val = respHeaders[key.toLowerCase()];
        if (val) lines.push(`${key}: ${val}`);
      }
      lines.push("");
      lines.push(body);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          status: response.status,
          statusText: response.statusText,
          url,
          headers: respHeaders,
          truncated,
          bodySize: Buffer.byteLength(rawBody, "utf-8"),
        },
      };
    },
  });
}
