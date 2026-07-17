import fs from "node:fs";
import path from "node:path";
import { clip, parseSimpleFrontmatter } from "./_utils.mjs";

export const parser = {
  name: "markdown-frontmatter",
  aliases: ["markdown", "md-frontmatter"],
  description: "Markdown files with YAML-ish frontmatter.",

  async canParse(ctx) {
    if (!ctx.target.exists || ctx.target.type !== "file") return 0;
    if (!ctx.target.resolved.match(/\.(md|markdown)$/i)) return 0;
    const raw = await ctx.readText(4096);
    return parseSimpleFrontmatter(raw).hasFrontmatter ? 90 : 25;
  },

  async summarize(ctx) {
    const raw = fs.readFileSync(ctx.target.resolved, "utf8");
    const parsed = parseSimpleFrontmatter(raw);
    const headings = parsed.body.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^#+\s+/.test(line));
    const frontmatterItems = Object.entries(parsed.attributes).slice(0, ctx.verbosity >= 2 ? 20 : 10).map(([key, value]) => `- ${key}: ${value}`);
    const preview = parsed.body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, ctx.verbosity >= 2 ? 10 : 5).map((line) => `- ${clip(line, 180)}`);
    return {
      summary: {
        title: `Markdown summary :: ${path.basename(ctx.target.resolved)}`,
        headline: clip(parsed.attributes.title || headings[0]?.replace(/^#+\s+/, "") || parsed.body.split(/\r?\n/).find((line) => line.trim()) || path.basename(ctx.target.resolved), 160),
        metrics: {
          has_frontmatter: parsed.hasFrontmatter,
          frontmatter_keys: Object.keys(parsed.attributes).length,
          headings: headings.length,
          body_lines: parsed.body.split(/\r?\n/).length,
        },
        sections: [
          { title: "frontmatter", items: frontmatterItems },
          { title: "headings", items: headings.slice(0, ctx.verbosity >= 2 ? 12 : 6).map((line) => `- ${line}`) },
          { title: "preview", items: preview },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        attributes: parsed.attributes,
        headings,
        preview: preview.map((line) => line.replace(/^-\s*/, "")),
      },
      warnings: parsed.hasFrontmatter ? [] : ["No frontmatter block found; summary is markdown-only."],
    };
  },
};
