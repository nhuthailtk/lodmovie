import { Generator, Parser } from "sparqljs";
import { MAX_RESPONSE_BYTES, RESULT_LIMIT } from "./config";
import { parseAccept, RDF_TYPES } from "./conneg";
import { getStore } from "./store";

export const RESULT_TYPES = {
  json: "application/sparql-results+json",
  xml: "application/sparql-results+xml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
} as const;

export class SparqlError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Form = "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";
export type Prepared = { query: string; form: Form; limited: boolean };
export type SparqlResult = { body: string; contentType: string; limited: boolean };

/** Parse the query, refuse updates, and cap the result size with LIMIT. */
export function prepareQuery(text: string): Prepared {
  let parsed;
  try {
    parsed = new Parser().parse(text);
  } catch (error) {
    throw new SparqlError(`SPARQL syntax error: ${(error as Error).message}`, 400);
  }
  if (parsed.type === "update") {
    throw new SparqlError("This endpoint is read-only: SPARQL UPDATE is not allowed.", 400);
  }
  const form = parsed.queryType as Form;
  // sparqljs supports LIMIT on SELECT, CONSTRUCT and DESCRIBE, but its types only declare it on SELECT.
  const limitable = parsed as { limit?: number };
  if (form === "ASK" || (limitable.limit !== undefined && limitable.limit <= RESULT_LIMIT)) {
    return { query: text, form, limited: false };
  }
  limitable.limit = RESULT_LIMIT;
  return { query: new Generator().stringify(parsed), form, limited: true };
}

function chooseType(form: Form, accept: string | null, format: string | null): string {
  const table: Record<string, string> = form === "SELECT" || form === "ASK" ? RESULT_TYPES : RDF_TYPES;
  if (format) {
    if (!Object.hasOwn(table, format)) {
      throw new SparqlError(`format "${format}" is not available for ${form}; use one of: ${Object.keys(table).join(", ")}`, 400);
    }
    return table[format];
  }
  const offered = Object.values(table);
  for (const { type } of parseAccept(accept).sort((a, b) => b.q - a.q)) {
    if (offered.includes(type)) return type;
    if (type === "application/json" && table === RESULT_TYPES) return RESULT_TYPES.json;
  }
  return offered[0];
}

export function runQuery(text: string, accept: string | null, format: string | null): SparqlResult {
  const prepared = prepareQuery(text);
  const contentType = chooseType(prepared.form, accept, format);
  let body: string;
  try {
    body = getStore().query(prepared.query, { use_default_graph_as_union: true, results_format: contentType }) as string;
  } catch (error) {
    throw new SparqlError(`Query failed: ${error instanceof Error ? error.message : String(error)}`, 400);
  }
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    throw new SparqlError(`The result is larger than ${MAX_RESPONSE_BYTES / 1_000_000} MB. Add a LIMIT or narrow the query.`, 413);
  }
  return { body, contentType, limited: prepared.limited };
}
