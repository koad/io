/**
 * Music controller — talks to kingofalldata.com/_music REST endpoints,
 * which proxy to Groove Basin via the storefront's groove-basin-connector.
 *
 * Commands: skip, queue, now, play, pause.
 * Now-playing also appears in the pi footer (getNowPlaying).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MUSIC_URL = process.env.KOAD_IO_CONTROL_URL ?? "http://10.10.10.10:28283";

let nowPlaying: string | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function getNowPlaying(): string | null { return nowPlaying; }

async function musicFetch(path: string, method = "GET", body?: any) {
  const opts: RequestInit = { method };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${MUSIC_URL}${path}`, opts);
  return res.json();
}

async function pollNowPlaying() {
  try {
    const data = await musicFetch("/_music/now");
    if (data.title) {
      const parts = [data.title];
      if (data.artist) parts.push(data.artist);
      nowPlaying = parts.join(" — ");
    } else {
      nowPlaying = null;
    }
  } catch (_) {
    nowPlaying = null;
  }
}

export function registerMusicTool(pi: ExtensionAPI): void {
  // Poll every 5s for footer display
  pollNowPlaying();
  _pollTimer = setInterval(pollNowPlaying, 5000);

  pi.registerTool({
    name: "music",
    label: "Music",
    description: [
      "Control the kingdom music stream via Groove Basin.",
      "Commands: skip, queue <song>, now, play, pause.",
      "Audience song requests from YouTube chat flow through this tool.",
    ].join("\n"),
    promptSnippet: "Control music (sub: skip|queue|now|play|pause)",
    promptGuidelines: [
      "Use music skip to skip the current track.",
      "Use music queue <key> to play a specific track by library key.",
      "Use music now to show what's currently playing.",
    ],
    parameters: Type.Object({
      sub: Type.String({ description: "Command: skip, queue, now, play, pause." }),
      query: Type.Optional(Type.String({ description: "Library key or search term for queue command." })),
    }),

    async execute(_toolCallId, params) {
      const sub = params.sub as string;

      switch (sub) {
        case "skip":
          await musicFetch("/_music/skip", "POST");
          return { content: [{ type: "text", text: "⏭ skipped" }], details: { action: "skip" } };
        case "queue": {
          const key = params.query || "";
          if (!key) throw new Error("music queue: key required");
          await musicFetch("/_music/queue", "POST", { key });
          return { content: [{ type: "text", text: `🎵 queued: ${key}` }], details: { action: "queue", key } };
        }
        case "now": {
          const np = getNowPlaying();
          return { content: [{ type: "text", text: np ? `🎵 ${np}` : "🎵 nothing playing" }], details: { nowPlaying: np } };
        }
        case "play":
          await musicFetch("/_music/play", "POST");
          return { content: [{ type: "text", text: "▶ playing" }], details: { action: "play" } };
        case "pause":
          await musicFetch("/_music/pause", "POST");
          return { content: [{ type: "text", text: "⏸ paused" }], details: { action: "pause" } };
        default:
          throw new Error(`Unknown music command: ${sub}. Valid: skip, queue, now, play, pause.`);
      }
    },
  });
}
