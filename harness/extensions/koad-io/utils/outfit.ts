// Entity outfit reader — reads ~/.<entity>/passenger.json, extracts HSL
// outfit colours, converts to ANSI true-color codes.
//
//   import { getEntityColor, entityStyle } from "./outfit";
//
//   const ansi = getEntityColor("vulcan");      // "\x1b[38;2;204;153;102m"
//   entityStyle("vulcan", "Vulcan");             // styled string

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityOutfit {
  hue: number;        // 0-360
  saturation: number; // 0-100
  lightness?: number; // default 50
}

export interface PassengerManifest {
  handle?: string;
  name?: string;
  outfit?: {
    hue?: number;
    saturation?: number;
    lightness?: number;
    visual?: { avatar?: string };
  };
}

// ---------------------------------------------------------------------------
// HSL → RGB conversion
// ---------------------------------------------------------------------------

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ---------------------------------------------------------------------------
// ANSI true-color escape helpers
// ---------------------------------------------------------------------------

const CSI = "\x1b[";
const RST = "\x1b[0m";

function ansiFg(r: number, g: number, b: number): string {
  return `${CSI}38;2;${r};${g};${b}m`;
}

function ansiBg(r: number, g: number, b: number): string {
  return `${CSI}48;2;${r};${g};${b}m`;
}

// ---------------------------------------------------------------------------
// Cache — outfits are read once, keyed by entity name
// ---------------------------------------------------------------------------

const outfitCache = new Map<string, EntityOutfit | null>();

function readOutfit(entity: string): EntityOutfit | null {
  const cached = outfitCache.get(entity);
  if (cached !== undefined) return cached;

  const file = path.join(HOME, `.${entity}`, "passenger.json");
  let outfit: EntityOutfit | null = null;

  try {
    const raw = fs.readFileSync(file, "utf8");
    const manifest: PassengerManifest = JSON.parse(raw);
    if (manifest.outfit && typeof manifest.outfit.hue === "number") {
      outfit = {
        hue: manifest.outfit.hue,
        saturation: manifest.outfit.saturation ?? 50,
        lightness: manifest.outfit.lightness ?? 50,
      };
    }
  } catch (_) {
    // No passenger.json, entity not installed, or parse error
  }

  outfitCache.set(entity, outfit);
  return outfit;
}

/** Clear the outfit cache (e.g. on /reload). */
export function clearOutfitCache(): void {
  outfitCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns an ANSI true-color foreground escape for the entity's outfit colour.
 * Falls back to null if the entity has no outfit defined.
 */
export function getEntityColor(entity: string): string | null {
  const outfit = readOutfit(entity);
  if (!outfit) return null;
  const [r, g, b] = hslToRgb(outfit.hue, outfit.saturation, outfit.lightness ?? 50);
  return ansiFg(r, g, b);
}

/**
 * Returns an ANSI true-color background escape for the entity's outfit colour.
 */
export function getEntityBg(entity: string): string | null {
  const outfit = readOutfit(entity);
  if (!outfit) return null;
  const [r, g, b] = hslToRgb(outfit.hue, outfit.saturation, outfit.lightness ?? 50);
  return ansiBg(r, g, b);
}

/**
 * Returns the raw RGB tuple for the entity's outfit colour.
 */
export function getEntityRgb(entity: string): [number, number, number] | null {
  const outfit = readOutfit(entity);
  if (!outfit) return null;
  return hslToRgb(outfit.hue, outfit.saturation, outfit.lightness ?? 50);
}

/**
 * Wraps text in the entity's outfit colour. Returns un-styled text if no outfit.
 *
 *   entityStyle("vulcan", "Vulcan")  →  "\x1b[38;2;204;153;102mVulcan\x1b[0m"
 */
export function entityStyle(entity: string, text: string): string {
  const fg = getEntityColor(entity);
  if (!fg) return text;
  return `${fg}${text}${RST}`;
}
