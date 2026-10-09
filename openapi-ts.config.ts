/**
 * The code generator's configuration: @hey-api/openapi-ts with the TypeScript types and zod v4 plugins and no client
 * plugin (the server keeps its own hardened fetch client). `scripts/spec-generate.mjs` loads this file through Node's
 * type stripping and runs the generator from its own toolchain in `scripts/spec-gen/`.
 *
 * What is generated: every operation an API key can reach and this server may expose (classes documented, spec_only
 * and v1_only — `src/spec/classify.ts` holds the rule), the schemas they reference, and `PriceQuote`, which no
 * operation references although every `dry_run` call answers with it (the overlay binds it, `src/spec/overlay.ts`).
 */
import { classify, EXPOSABLE_CLASSES, operationKey } from "./src/spec/classify.ts";
import type { HttpMethod, SecurityRequirement } from "./src/spec/classify.ts";

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly security?: ReadonlyArray<Readonly<Record<string, readonly string[]>>>;
}

export interface OpenApiDocument {
  readonly security?: ReadonlyArray<Readonly<Record<string, readonly string[]>>>;
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
}

/** The schemas kept although no generated operation references them. */
export const SCHEMAS_KEPT: readonly string[] = ["PriceQuote"];

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function securityNames(
  security: OpenApiOperation["security"] | undefined,
): readonly SecurityRequirement[] | null {
  if (security === undefined) return null;
  return security.map((requirement) => Object.keys(requirement));
}

/** `METHOD /path` of every operation the generated code must cover, in the specification's order. */
export function exposedOperationKeys(spec: OpenApiDocument): string[] {
  const documentSecurity = securityNames(spec.security) ?? [];
  const keys: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method.toLowerCase()];
      if (op?.operationId === undefined) continue;
      const cls = classify({ method, path, security: securityNames(op.security) }, documentSecurity);
      if (EXPOSABLE_CLASSES.has(cls)) keys.push(operationKey({ method, path }));
    }
  }
  return keys;
}

export function generatorConfig(spec: OpenApiDocument, outputPath: string) {
  return {
    input: spec,
    output: { path: outputPath, entryFile: false, postProcess: [] },
    parser: {
      filters: {
        operations: { include: exposedOperationKeys(spec) },
        schemas: { include: [...SCHEMAS_KEPT] },
      },
    },
    plugins: [
      { name: "@hey-api/typescript", comments: false },
      { name: "zod", compatibilityVersion: 4, comments: false },
    ],
    logs: { level: "silent" },
  };
}
