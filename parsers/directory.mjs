import fs from "node:fs";
import path from "node:path";
import { formatNumber } from "./_utils.mjs";

export const parser = {
  name: "directory",
  aliases: ["dir", "folder"],
  description: "Filesystem directories.",

  async canParse(ctx) {
    return ctx.target.exists && ctx.target.type === "directory" ? 100 : 0;
  },

  async summarize(ctx) {
    const entries = fs.readdirSync(ctx.target.resolved, { withFileTypes: true });
    const counts = { directories: 0, files: 0, other: 0 };
    const extensions = new Map();
    for (const entry of entries) {
      if (entry.isDirectory()) counts.directories += 1;
      else if (entry.isFile()) {
        counts.files += 1;
        const ext = path.extname(entry.name) || "<none>";
        extensions.set(ext, (extensions.get(ext) || 0) + 1);
      } else counts.other += 1;
    }
    return {
      summary: {
        title: `Directory summary :: ${path.basename(ctx.target.resolved) || ctx.target.resolved}`,
        headline: `${formatNumber(entries.length)} entries · ${counts.directories} dir · ${counts.files} file`,
        metrics: {
          entries: entries.length,
          directories: counts.directories,
          files: counts.files,
          other: counts.other,
        },
        sections: [
          {
            title: "top entries",
            items: entries.slice(0, ctx.verbosity >= 2 ? 24 : 12).map((entry) => `- ${entry.isDirectory() ? "[d]" : entry.isFile() ? "[f]" : "[?]"} ${entry.name}`),
          },
          {
            title: "extensions",
            items: Array.from(extensions.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ext, count]) => `- ${ext}: ${count}`),
          },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        counts,
        entries: entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" })),
        extensions: Object.fromEntries(extensions),
      },
      warnings: [],
    };
  },
};
