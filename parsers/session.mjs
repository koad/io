import fs from "node:fs";
import path from "node:path";
import { clip, ensureArray, firstNonEmpty, formatMoney, parseJsonlLine } from "./_utils.mjs";

function contentBlocksToText(blocks, { includeThinking = false, limit = 240 } = {}) {
  const parts = [];
  for (const block of ensureArray(blocks)) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && block.text) parts.push(String(block.text));
    if (includeThinking && block.type === "thinking" && block.thinking) parts.push(String(block.thinking));
  }
  return clip(parts.join(" "), limit);
}

function gatherToolCalls(blocks) {
  const calls = [];
  for (const block of ensureArray(blocks)) {
    if (!block || typeof block !== "object") continue;
    if (block.type !== "toolCall") continue;
    calls.push({
      id: block.id || null,
      name: block.name || "unknown",
      arguments: block.arguments ?? {},
    });
  }
  return calls;
}

export const parser = {
  name: "session",
  aliases: ["session-jsonl", "pi-session"],
  description: "Pi harness session JSONL files.",

  async canParse(ctx) {
    if (!ctx.target.exists || ctx.target.type !== "file") return 0;
    if (!ctx.target.resolved.endsWith(".jsonl")) return 0;
    const line = await ctx.readFirstLine();
    if (!line) return 0;
    const parsed = parseJsonlLine(line);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return 0;
    return parsed.value.type === "session" ? 100 : 0;
  },

  async summarize(ctx) {
    const lines = fs.readFileSync(ctx.target.resolved, "utf8").split(/\r?\n/);
    const warnings = [];
    let malformedLines = 0;
    let sessionMeta = null;
    let sessionInfo = null;
    let customBanner = null;
    const roleCounts = new Map();
    const userMessages = [];
    const assistantMessages = [];
    const toolCalls = [];
    const customMessages = [];
    let totalTokens = 0;
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let errors = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;

    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      const parsed = parseJsonlLine(rawLine);
      if (!parsed.ok) {
        malformedLines += 1;
        continue;
      }
      const entry = parsed.value;
      if (!entry || typeof entry !== "object") continue;
      if (entry.timestamp) {
        firstTimestamp ??= entry.timestamp;
        lastTimestamp = entry.timestamp;
      }
      if (entry.type === "session") sessionMeta = entry;
      if (entry.type === "session_info") sessionInfo = entry;
      if (entry.type === "custom_message" && entry.display !== false && !customBanner) {
        customBanner = clip(entry.content || "", 240);
      }
      if (entry.type === "custom_message") {
        customMessages.push(`${entry.customType || "custom"}: ${clip(entry.content || "", 160)}`);
      }
      if (entry.type !== "message") continue;
      const message = entry.message || {};
      const role = message.role || "unknown";
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
      if (entry.isError || message.isError) errors += 1;
      if (role === "user") {
        userMessages.push(contentBlocksToText(message.content, { includeThinking: false, limit: 180 }));
      }
      if (role === "assistant") {
        const assistantText = contentBlocksToText(message.content, { includeThinking: false, limit: 180 });
        const assistantToolCalls = gatherToolCalls(message.content);
        assistantMessages.push(assistantText || (assistantToolCalls.length ? `[tool call only: ${assistantToolCalls.map((call) => call.name).join(", ")}]` : "[assistant message with no text blocks]"));
        toolCalls.push(...assistantToolCalls);
        const usage = message.usage || {};
        totalTokens += Number(usage.totalTokens || 0);
        totalInputTokens += Number(usage.input || 0);
        totalOutputTokens += Number(usage.output || 0);
        totalCacheRead += Number(usage.cacheRead || 0);
        totalCacheWrite += Number(usage.cacheWrite || 0);
        totalCost += Number(usage.cost?.total || 0);
      }
    }

    if (malformedLines) warnings.push(`${malformedLines} malformed JSONL line(s) skipped.`);
    if (!sessionMeta) warnings.push("No session header found.");

    const messageEntries = Array.from(roleCounts.values()).reduce((sum, count) => sum + count, 0);
    const durationSeconds = firstTimestamp && lastTimestamp
      ? Math.max(0, Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000))
      : null;

    return {
      summary: {
        title: `Session summary :: ${path.basename(ctx.target.resolved)}`,
        headline: firstNonEmpty(customBanner, `Session ${sessionMeta?.id || path.basename(ctx.target.resolved)} in ${sessionMeta?.cwd || sessionInfo?.name || path.dirname(ctx.target.resolved)}`) || "",
        metrics: {
          turns: messageEntries,
          tool_calls: toolCalls.length,
          errors,
          tokens: totalTokens,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          cache_read_tokens: totalCacheRead,
          cache_write_tokens: totalCacheWrite,
          cost: Number(totalCost.toFixed(6)),
          duration_seconds: durationSeconds,
          cwd: sessionMeta?.cwd || null,
        },
        sections: [
          {
            title: "roles",
            items: Array.from(roleCounts.entries()).map(([role, count]) => `${role}: ${count}`),
          },
          {
            title: "user messages",
            items: userMessages.filter(Boolean).slice(0, ctx.verbosity >= 2 ? 12 : 6).map((text) => `- ${text}`),
          },
          {
            title: "assistant responses",
            items: assistantMessages.filter(Boolean).slice(0, ctx.verbosity >= 2 ? 12 : 6).map((text) => `- ${text}`),
          },
          {
            title: "tool calls",
            items: toolCalls.slice(0, ctx.verbosity >= 2 ? 20 : 10).map((call) => `- ${call.name} ${JSON.stringify(call.arguments)}`),
          },
          {
            title: "custom messages",
            items: customMessages.slice(0, ctx.verbosity >= 2 ? 8 : 4).map((text) => `- ${text}`),
          },
        ].filter((section) => section.items.length > 0),
        compat_footer: {
          Turns: messageEntries,
          "Tool calls": toolCalls.length,
          Errors: errors,
          Tokens: totalTokens,
          Cost: formatMoney(totalCost),
        },
      },
      data: {
        session_id: sessionMeta?.id || null,
        cwd: sessionMeta?.cwd || null,
        name: sessionInfo?.name || null,
        message_entries: messageEntries,
        role_counts: Object.fromEntries(roleCounts),
        tool_calls: toolCalls,
        malformed_lines: malformedLines,
        started_at: firstTimestamp,
        ended_at: lastTimestamp,
        duration_seconds: durationSeconds,
        token_usage: {
          total: totalTokens,
          input: totalInputTokens,
          output: totalOutputTokens,
          cache_read: totalCacheRead,
          cache_write: totalCacheWrite,
        },
        cost_total: Number(totalCost.toFixed(6)),
        samples: {
          user: userMessages.filter(Boolean).slice(0, 8),
          assistant: assistantMessages.filter(Boolean).slice(0, 8),
        },
      },
      warnings,
    };
  },
};
