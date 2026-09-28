import { iriRef } from "./rdf";
import { ask, serialize } from "./store";

export function exists(iri: string): boolean {
  return ask(`ASK { ${iriRef(iri)} ?p ?o }`);
}

/** The resource's own triples plus up to 500 incoming ones, serialised as `format`. */
export function describe(iri: string, format: string): string | null {
  if (!exists(iri)) return null;
  const r = iriRef(iri);
  return serialize(
    `CONSTRUCT { ${r} ?p ?o . ?s ?q ${r} } WHERE { { ${r} ?p ?o } UNION { SELECT ?s ?q WHERE { ?s ?q ${r} } LIMIT 500 } }`,
    format,
  );
}
