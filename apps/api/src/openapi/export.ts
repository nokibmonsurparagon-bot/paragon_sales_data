// Writes the OpenAPI document to docs/openapi.json (npm run openapi:export -w @paragon/api).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2));
console.warn(`OpenAPI written to ${out}`);
process.exit(0);
