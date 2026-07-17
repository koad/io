import fs from "node:fs";
import path from "node:path";
import { clip, collectTopLevelShape, formatBytes, formatNumber, safeJsonParse } from "./_utils.mjs";

export const parser = {
  name: "json",
  aliases: [],
  description: "Plain JSON files.",

  async canParse(ctx) {
    if (!ctx.target.exists || ctx.target.type !== "file") return 0;
    if (ctx.target.resolved.endsWith(".json")) return 90;
    const raw = await ctx.readText(4096);
    const trimmed = raw.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[") ? 40 : 0;
  },

  async summarize(ctx) {
    const raw = fs.readFileSync(ctx.target.resolved, "utf8");
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      throw new Error(`Invalid JSON: ${parsed.error}`);
    }
    const value = parsed.value;
    const shape = collectTopLevelShape(value);
    const preview = JSON.stringify(value, null, 2);
    const previewLines = preview.split("\n").slice(0, ctx.verbosity >= 2 ? 24 : 10).map((line) => `- ${line}`);
    return {
      summary: {
        title: `JSON summary :: ${path.basename(ctx.target.resolved)}`,
        headline: `${shape.kind}${shape.length != null ? ` with ${formatNumber(shape.length)} entries` : shape.keys != null ? ` with ${formatNumber(shape.keys)} keys` : ""}`,
        metrics: {
          bytes: ctx.target.size_bytes,
          top_level_kind: shape.kind,
          keys: shape.keys ?? null,
          length: shape.length ?? null,
        },
        sections: [
          {
            title: "shape",
            items: shape.sample?.map((entry) => typeof entry === "string" ? `- ${entry}` : `- ${entry.key}: ${entry.type}`) || [],
          },
          {
            title: "preview",
            items: previewLines,
          },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        top_level_shape: shape,
        bytes: ctx.target.size_bytes,
        preview: preview.slice(0, 4000),
      },
      warnings: [],
    };
  },
};
