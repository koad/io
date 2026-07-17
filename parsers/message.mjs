import fs from "node:fs";
import path from "node:path";
import { clip, parseSimpleFrontmatter } from "./_utils.mjs";

export const parser = {
  name: "message",
  aliases: ["inbox-message"],
  description: "Forge inbox message markdown files.",

  async canParse(ctx) {
    if (!ctx.target.exists || ctx.target.type !== "file") return 0;
    if (!ctx.target.resolved.match(/\.md$/i)) return 0;
    const raw = await ctx.readText(4096);
    const parsed = parseSimpleFrontmatter(raw);
    if (ctx.target.resolved.includes(`${path.sep}messages${path.sep}`)) return 100;
    const attrs = parsed.attributes || {};
    return attrs.from && attrs.to && attrs.timestamp ? 85 : 0;
  },

  async summarize(ctx) {
    const raw = fs.readFileSync(ctx.target.resolved, "utf8");
    const parsed = parseSimpleFrontmatter(raw);
    const attrs = parsed.attributes || {};
    const bodyLines = parsed.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      summary: {
        title: `Message summary :: ${path.basename(ctx.target.resolved)}`,
        headline: `${attrs.from || "unknown"} → ${attrs.to || "unknown"} · ${clip(bodyLines[0] || "(empty)", 160)}`,
        metrics: {
          from: attrs.from || null,
          to: attrs.to || null,
          type: attrs.type || null,
          timestamp: attrs.timestamp || null,
          body_lines: bodyLines.length,
        },
        sections: [
          {
            title: "metadata",
            items: Object.entries(attrs).slice(0, 12).map(([key, value]) => `- ${key}: ${value}`),
          },
          {
            title: "body preview",
            items: bodyLines.slice(0, ctx.verbosity >= 2 ? 12 : 6).map((line) => `- ${clip(line, 180)}`),
          },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        attributes: attrs,
        body_preview: bodyLines.slice(0, 12),
      },
      warnings: [],
    };
  },
};
