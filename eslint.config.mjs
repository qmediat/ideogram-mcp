// @ts-check
// Structure lint: the shared preset (lint/structure.mjs). TypeScript 7 has no JavaScript API for typescript-eslint
// to parse with, so Babel parses the TypeScript. Generated code is held by its generator's check, not here.
import babelParser from "@babel/eslint-parser";
import { structure } from "./lint/structure.mjs";

export default [
  { ignores: ["dist/**", "src/generated/**", "scripts/spec-gen/**", ".jscpd-report/**"] },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ["typescript"] } },
      },
    },
  },
  ...structure(),
];
