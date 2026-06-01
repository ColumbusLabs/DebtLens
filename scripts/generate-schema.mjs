#!/usr/bin/env node
// Regenerate schema/debtlens.config.schema.json from src/config/schema.ts.
// Run via: node --import tsx scripts/generate-schema.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfigSchema } from "../src/config/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "schema");
mkdirSync(outDir, { recursive: true });

const outFile = join(outDir, "debtlens.config.schema.json");
writeFileSync(outFile, `${JSON.stringify(buildConfigSchema(), null, 2)}\n`, "utf8");
console.log(`Wrote ${outFile}`);
