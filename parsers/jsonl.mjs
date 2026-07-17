import fs from "node:fs";
import path from "node:path";
import { clip, collectTopLevelShape, formatNumber, parseJsonlLine } from "./_utils.mjs";

export const parser = {
  name: "jsonl",
  aliases: ["ndjson"],
  description: "One JSON object per line files.",

  async canParse(ctx) {
    if (!ctx.target.exists || ctx.target.type !== "file") return 0;
    if (ctx.target.resolved.endsWith(".jsonl")) return 85;
    const firstLine = await ctx.readFirstLine();
    const parsed = parseJsonlLine(firstLine || "");
    return parsed.ok ? 30 : 0;
  },

  async summarize(ctx) {
    const lines = fs.readFileSync(ctx.target.resolved, "utf8").split(/\r?\n/);
    let parsedCount = 0;
    let malformedCount = 0;
    const typeCounts = new Map();
    const topLevelKeys = new Map();
    const samples = [];
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      const parsed = parseJsonlLine(rawLine);
      if (!parsed.ok) {
        malformedCount += 1;
        continue;
      }
      parsedCount += 1;
      const value = parsed.value;
      if (samples.length < (ctx.verbosity >= 2 ? 5 : 3)) {
        samples.push(clip(JSON.stringify(value), 220));
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const type = value.type || value.kind || "object";
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        for (const key of Object.keys(value).slice(0, 20)) {
          topLevelKeys.set(key, (topLevelKeys.get(key) || 0) + 1);
        }
      }
    }
    return {
      summary: {
        title: `JSONL summary :: ${path.basename(ctx.target.resolved)}`,
        headline: `${formatNumber(parsedCount)} parsed lines${malformedCount ? `, ${formatNumber(malformedCount)} malformed` : ""}`,
        metrics: {
          parsed_lines: parsedCount,
          malformed_lines: malformedCount,
          total_lines: lines.filter((line) => line.trim()).length,
        },
        sections: [
          {
            title: "record types",
            items: Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([type, count]) => `- ${type}: ${count}`),
          },
          {
            title: "common keys",
            items: Array.from(topLevelKeys.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => `- ${key}: ${count}`),
          },
          {
            title: "samples",
            items: samples.map((sample) => `- ${sample}`),
          },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        parsed_lines: parsedCount,
        malformed_lines: malformedCount,
        type_counts: Object.fromEntries(typeCounts),
        common_keys: Object.fromEntries(topLevelKeys),
        samples,
      },
      warnings: malformedCount ? [`${malformedCount} line(s) were not valid JSON.`] : [],
    };
  },
};
