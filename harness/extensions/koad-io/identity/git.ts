// Git status polling — parses `git status --porcelain=2 --branch`.

import * as cp from "node:child_process";

export interface GitState {
  isRepo: boolean;
  branch: string;
  upstream: string;
  remote: string;       // e.g. keybase://team/kingofalldata.entities.juno/self
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  deleted: number;
  untracked: number;
  conflicted: number;
}

export const EMPTY_GIT: GitState = {
  isRepo: false,
  branch: "",
  upstream: "",
  remote: "",
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  deleted: 0,
  untracked: 0,
  conflicted: 0,
};

export function pollGit(): GitState {
  const g: GitState = { ...EMPTY_GIT };

  try {
    const cwd = process.env.PWD || process.cwd();

    // Porcelain status
    const out = cp.execFileSync("git", ["-C", cwd, "status", "--porcelain=2", "--branch"], {
      encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
    });
    g.isRepo = true;

    for (const line of out.split("\n")) {
      if (!line) continue;
      if (line.startsWith("# branch.head "))      { g.branch   = line.slice("# branch.head ".length).trim(); continue; }
      if (line.startsWith("# branch.upstream "))   { g.upstream = line.slice("# branch.upstream ".length).trim(); continue; }
      if (line.startsWith("# branch.ab ")) {
        const m = line.match(/\+([0-9]+)\s+-([0-9]+)/);
        g.ahead  = m ? Number(m[1]) : 0;
        g.behind = m ? Number(m[2]) : 0;
        continue;
      }
      if (line.startsWith("? ")) { g.untracked++; continue; }
      if (line.startsWith("u ")) { g.conflicted++; continue; }
      if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const xy = line.split(" ")[1] || "..";
        const x = xy[0] || ".";
        const y = xy[1] || ".";
        if (x !== ".") g.staged++;
        if (y !== ".") g.modified++;
        if (x === "D" || y === "D") g.deleted++;
      }
    }

    // Remote URL
    try {
      const remoteOut = cp.execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
        encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
      });
      g.remote = remoteOut.trim();
    } catch (_) {}

  } catch (_) {}

  return g;
}
