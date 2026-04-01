import { z } from "zod/v4";

const ConfigSchema = z.object({
  apiKey: z.string().min(1, "IDEOGRAM_API_KEY is required"),
  outputDir: z.string().min(1).default("/tmp/ideogram-output"),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  cachedConfig = ConfigSchema.parse({
    apiKey: process.env.IDEOGRAM_API_KEY,
    outputDir: process.env.IDEOGRAM_OUTPUT_DIR,
  });

  return cachedConfig;
}
