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

function roleSummaryItems({ userTurns, assistantTurns, auxiliaryEntries, rawRoleCounts }) {
  const items = [
    `user: ${userTurns}`,
    `assistant: ${assistantTurns}`,
  ];
  const extraRoles = Array.from(rawRoleCounts.entries()).filter(([role]) => !["user", "assistant"].includes(role));
  if (auxiliaryEntries > 0) items.push(`auxiliary: ${auxiliaryEntries}`);
  for (const [role, count] of extraRoles.slice(0, 6)) items.push(`${role}: ${count}`);
  return items;
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
    const rawRoleCounts = new Map();
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
    let userTurns = 0;
    let assistantTurns = 0;
    let auxiliaryEntries = 0;

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
        continue;
      }
      if (entry.type === "tool_call") {
        toolCalls.push({
          id: entry.toolCallId || entry.id || null,
          name: entry.toolName || entry.name || "unknown",
          arguments: entry.arguments ?? {},
        });
        continue;
      }
      if (entry.type === "tool_result") {
        if (entry.isError) errors += 1;
        continue;
      }
      if (entry.type !== "message") continue;

      const message = entry.message || {};
      const role = message.role || "unknown";
      rawRoleCounts.set(role, (rawRoleCounts.get(role) || 0) + 1);
      if (entry.isError || message.isError) errors += 1;

      if (role === "user") {
        userTurns += 1;
        userMessages.push(contentBlocksToText(message.content, { includeThinking: false, limit: 180 }));
        continue;
      }

      if (role === "assistant") {
        assistantTurns += 1;
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
        continue;
      }

      auxiliaryEntries += 1;
    }

    if (malformedLines) warnings.push(`${malformedLines} malformed JSONL line(s) skipped.`);
    if (!sessionMeta) warnings.push("No session header found.");
    if (auxiliaryEntries) {
      const details = Array.from(rawRoleCounts.entries())
        .filter(([role]) => !["user", "assistant"].includes(role))
        .map(([role, count]) => `${role}:${count}`)
        .join(", ");
      warnings.push(`${auxiliaryEntries} non-conversation message entr${auxiliaryEntries === 1 ? "y was" : "ies were"} excluded from turn counts${details ? ` (${details}).` : "."}`);
    }

    const turns = userTurns + assistantTurns;
    const durationSeconds = firstTimestamp && lastTimestamp
      ? Math.max(0, Math.round((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 1000))
      : null;

    const userLimit = ctx.verbosity >= 2 ? 12 : 6;
    const assistantLimit = ctx.verbosity >= 2 ? 12 : 6;
    const toolLimit = ctx.verbosity >= 2 ? 20 : 10;
    const customLimit = ctx.verbosity >= 2 ? 8 : 4;

    const userPreview = userMessages.filter(Boolean).slice(0, userLimit);
    const assistantPreview = assistantMessages.filter(Boolean).slice(0, assistantLimit);
    const toolPreview = toolCalls.slice(0, toolLimit);
    const customPreview = customMessages.slice(0, customLimit);

    return {
      summary: {
        title: `Session summary :: ${path.basename(ctx.target.resolved)}`,
        headline: firstNonEmpty(customBanner, `Session ${sessionMeta?.id || path.basename(ctx.target.resolved)} in ${sessionMeta?.cwd || sessionInfo?.name || path.dirname(ctx.target.resolved)}`) || "",
        metrics: {
          turns,
          user_turns: userTurns,
          assistant_turns: assistantTurns,
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
            title: "conversation shape",
            items: roleSummaryItems({ userTurns, assistantTurns, auxiliaryEntries, rawRoleCounts }),
          },
          {
            title: "user messages",
            items: userPreview.map((text) => `- ${text}`),
          },
          {
            title: "assistant responses",
            items: assistantPreview.map((text) => `- ${text}`),
          },
          {
            title: "tool calls",
            items: toolPreview.map((call) => `- ${call.name} ${JSON.stringify(call.arguments)}`),
          },
          {
            title: "custom messages",
            items: customPreview.map((text) => `- ${text}`),
          },
        ].filter((section) => section.items.length > 0),
        compat_footer: {
          Turns: turns,
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
        turns,
        user_turns: userTurns,
        assistant_turns: assistantTurns,
        role_counts: Object.fromEntries(rawRoleCounts),
        tool_calls: toolPreview,
        user_messages: userPreview,
        assistant_responses: assistantPreview,
        custom_messages: customPreview,
        omitted_counts: {
          user_messages: Math.max(0, userMessages.filter(Boolean).length - userPreview.length),
          assistant_responses: Math.max(0, assistantMessages.filter(Boolean).length - assistantPreview.length),
          tool_calls: Math.max(0, toolCalls.length - toolPreview.length),
          custom_messages: Math.max(0, customMessages.length - customPreview.length),
        },
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
      },
      warnings,
    };
  },
};
