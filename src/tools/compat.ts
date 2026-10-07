/**
 * The 1.x compatibility adapter (docs/DESIGN-ideogram-v2.md section 7). Compatibility is defined per model: v1's
 * uppercase `rendering_speed` is lowercased for a model that takes `rendering_speed` (Ideogram 3.x / 4.0), mapped to
 * `quality` for a model that takes `quality` (4.5), and left to the field check otherwise; FLASH exists nowhere in v2's
 * speed ladder. Uppercase `magic_prompt` / `style_type` values and palette preset names are lowercased; the 1.x model
 * names "3.0" / "4.0" and describe's `describe_model_version` name the v2 model ids. Every mapping is said in the
 * tool's result.
 */
import type { ToolArguments } from "./family.js";

export interface Adapted {
  readonly fields: Record<string, unknown>;
  readonly notes: readonly string[];
}

/** 1.x model names by tool family. */
export const MODEL_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  generate: { "3.0": "ideogram-3", "4.0": "ideogram-4" },
};

/** v1 speed → v2 quality, rung for rung (the four speeds onto the four qualities). */
export const SPEED_TO_QUALITY: Readonly<Record<string, string>> = {
  FLASH: "very_low",
  TURBO: "low",
  DEFAULT: "medium",
  QUALITY: "high",
};

const LOWERCASED_ENUMS: readonly string[] = ["magic_prompt", "style_type"];

/** The model a call asks for: its alias resolved, or describe's 1.x version field read. */
export function resolveModel(family: string, args: ToolArguments, fallback: string): { model: string; notes: string[] } {
  const notes: string[] = [];
  let model = typeof args.model === "string" ? args.model : fallback;
  const alias = MODEL_ALIASES[family]?.[model];
  if (alias !== undefined) {
    notes.push(`model "${model}" → ${alias}`);
    model = alias;
  }
  if (family === "describe" && args.describe_model_version !== undefined) {
    if (args.describe_model_version !== "V_3") {
      throw new Error(`describe_model_version ${String(args.describe_model_version)} has no v2 model; use model ideogram-3 or ideogram-4`);
    }
    notes.push("describe_model_version V_3 → model ideogram-3");
    model = "ideogram-3";
  }
  return { model, notes };
}

function adaptSpeed(fields: Record<string, unknown>, takes: ReadonlySet<string>, notes: string[]): void {
  const speed = fields.rendering_speed;
  if (typeof speed !== "string" || speed !== speed.toUpperCase() || !(speed in SPEED_TO_QUALITY)) return;
  if (takes.has("quality") && !takes.has("rendering_speed")) {
    delete fields.rendering_speed;
    fields.quality = SPEED_TO_QUALITY[speed];
    notes.push(`rendering_speed ${speed} → quality ${SPEED_TO_QUALITY[speed]}`);
    return;
  }
  if (!takes.has("rendering_speed")) return;
  if (speed === "FLASH") throw new Error("rendering_speed FLASH does not exist in v2; the fastest is turbo");
  fields.rendering_speed = speed.toLowerCase();
  notes.push(`rendering_speed ${speed} → ${speed.toLowerCase()}`);
}

function adaptPalette(fields: Record<string, unknown>, takes: ReadonlySet<string>, notes: string[]): void {
  const palette = fields.color_palette as { name?: unknown } | undefined;
  const name = palette?.name;
  if (!takes.has("color_palette") || typeof name !== "string" || name !== name.toUpperCase()) return;
  fields.color_palette = { ...palette, name: name.toLowerCase() };
  notes.push(`color_palette ${name} → ${name.toLowerCase()}`);
}

/** Maps the 1.x spellings in `fields` for a model that takes the fields in `takes`. */
export function adaptFields(input: ToolArguments, takes: ReadonlySet<string>): Adapted {
  const fields: Record<string, unknown> = { ...input };
  delete fields.describe_model_version;
  const notes: string[] = [];
  adaptSpeed(fields, takes, notes);
  adaptPalette(fields, takes, notes);
  for (const name of LOWERCASED_ENUMS) {
    const value = fields[name];
    if (typeof value !== "string" || value !== value.toUpperCase() || !takes.has(name)) continue;
    fields[name] = value.toLowerCase();
    notes.push(`${name} ${value} → ${value.toLowerCase()}`);
  }
  return { fields, notes };
}
