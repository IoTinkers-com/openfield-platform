// Validación local contra los schemas canónicos (contrato, D9).
// Usa ajv (draft 2020-12), el mismo que correrá en el navegador en Fase 1.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.join(__dirname, "..", "schemas");

// strict:false -> los `format` (p. ej. date-time) son anotación, igual que jsonschema/Python.
// logger:false -> sin avisos de "unknown format".
const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
const validators = new Map();

for (const name of readdirSync(SCHEMAS_DIR)) {
  if (!name.endsWith(".schema.json")) continue;
  const stem = name.split(".")[0];
  const schema = JSON.parse(readFileSync(path.join(SCHEMAS_DIR, name), "utf-8"));
  validators.set(stem, ajv.compile(schema));
}

export function validate(entityType, doc) {
  const v = validators.get(entityType);
  if (!v) throw new Error(`entity_type desconocido: ${entityType}`);
  if (!v(doc)) throw new Error(`documento inválido: ${ajv.errorsText(v.errors)}`);
  return doc;
}
