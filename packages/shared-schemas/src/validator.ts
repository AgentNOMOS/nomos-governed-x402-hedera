/**
 * Minimal, dependency-free validator for the JSON Schema subset this project uses.
 *
 * Why not ajv: today's deliverable must run offline with zero install, and the
 * schema surface here is small and fully under our control. The supported
 * keyword set is deliberately narrow and *fails closed* on anything it does not
 * understand — an unrecognised keyword is an error, never a silent pass.
 *
 * Supported: type, const, enum, required, properties, additionalProperties,
 *            items, pattern, minLength, maxLength, minimum, maximum,
 *            minItems, maxItems, nullable, description, $schema, $id, title.
 */

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export class SchemaError extends Error {
  readonly issues: ValidationIssue[];
  constructor(schemaId: string, issues: ValidationIssue[]) {
    super(
      `schema ${schemaId} rejected the document: ` +
        issues.map((i) => `${i.path || "$"} ${i.code}`).join(", "),
    );
    this.name = "SchemaError";
    this.issues = issues;
  }
}

export type Schema = Record<string, any>;

const KNOWN_KEYWORDS = new Set([
  "$schema", "$id", "title", "description", "type", "const", "enum",
  "required", "properties", "additionalProperties", "items", "pattern",
  "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems",
  "nullable", "examples",
]);

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v as number)) return "integer";
  return typeof v;
}

function matchesType(v: unknown, want: string): boolean {
  const actual = typeOf(v);
  if (want === "number") return actual === "integer" || actual === "number";
  if (want === "object") return actual === "object";
  return actual === want;
}

function walk(value: unknown, schema: Schema, path: string, out: ValidationIssue[]): void {
  for (const kw of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(kw)) {
      out.push({
        path,
        code: "UNSUPPORTED_KEYWORD",
        message: `validator does not implement "${kw}" — refusing to pass silently`,
      });
      return;
    }
  }

  if (schema.nullable === true && value === null) return;

  if (schema.type !== undefined) {
    const wanted: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!wanted.some((w) => matchesType(value, w))) {
      out.push({
        path,
        code: "TYPE_MISMATCH",
        message: `expected ${wanted.join("|")}, got ${typeOf(value)}`,
      });
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    out.push({ path, code: "CONST_MISMATCH", message: `expected ${JSON.stringify(schema.const)}` });
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    out.push({
      path,
      code: "ENUM_MISMATCH",
      message: `expected one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(", ")}`,
    });
  }

  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      out.push({ path, code: "PATTERN_MISMATCH", message: `does not match ${schema.pattern}` });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      out.push({ path, code: "TOO_SHORT", message: `minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      out.push({ path, code: "TOO_LONG", message: `maxLength ${schema.maxLength}` });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      out.push({ path, code: "TOO_SMALL", message: `minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      out.push({ path, code: "TOO_LARGE", message: `maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      out.push({ path, code: "TOO_FEW_ITEMS", message: `minItems ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      out.push({ path, code: "TOO_MANY_ITEMS", message: `maxItems ${schema.maxItems}` });
    }
    if (schema.items) {
      value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, out));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props: Record<string, Schema> = schema.properties ?? {};

    for (const req of (schema.required ?? []) as string[]) {
      // Fail-closed on missing AND on explicit undefined: a required field that
      // is present-but-undefined is exactly the gap a partial binding leaves.
      if (!(req in obj) || obj[req] === undefined) {
        out.push({ path: `${path}.${req}`, code: "REQUIRED_MISSING", message: "required field absent" });
      }
    }

    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props)) {
          out.push({
            path: `${path}.${k}`,
            code: "ADDITIONAL_PROPERTY",
            message: "property not declared by the schema",
          });
        }
      }
    }

    for (const [k, sub] of Object.entries(props)) {
      if (k in obj && obj[k] !== undefined) walk(obj[k], sub, `${path}.${k}`, out);
    }
  }
}

/** Collect issues without throwing. Empty array == valid. */
export function validate(value: unknown, schema: Schema): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  walk(value, schema, "", issues);
  return issues;
}

/** Fail-closed variant: throws {@link SchemaError} on the first invalid document. */
export function assertValid<T = unknown>(value: unknown, schema: Schema): T {
  const issues = validate(value, schema);
  if (issues.length > 0) throw new SchemaError(String(schema.$id ?? "<anonymous>"), issues);
  return value as T;
}
