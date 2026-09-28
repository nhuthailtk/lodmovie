import { DATASET, MO, ONTOLOGY, PREFIXES, RESOURCE, RESOURCE_TYPES, type ResourceType } from "./config";

export type Term = { type: "uri" | "literal" | "bnode"; value: string; lang?: string; datatype?: string };
export type Row = Record<string, Term | undefined>;

const ID = /^[A-Za-z0-9-]+$/;
const SAFE_IRI = /^https?:\/\/[^\s<>"{}|\\^`]+$/;

export function resourceIri(type: string, id: string): string | null {
  if (!(RESOURCE_TYPES as readonly string[]).includes(type) || !ID.test(id)) return null;
  return `${RESOURCE}${type}/${id}`;
}

export function resourcePath(iri: string): { type: ResourceType; id: string } | null {
  if (!iri.startsWith(RESOURCE)) return null;
  const [type, id, ...rest] = iri.slice(RESOURCE.length).split("/");
  if (rest.length || !resourceIri(type, id ?? "")) return null;
  return { type: type as ResourceType, id };
}

/** Where a browser should go for this IRI inside the site, or null if it is external. */
export function pageHref(iri: string): string | null {
  const local = resourcePath(iri);
  if (local) return `/page/${local.type}/${local.id}`;
  if (iri.startsWith(MO)) return `/ontology#${iri.slice(MO.length)}`;
  if (iri === ONTOLOGY) return "/ontology";
  if (iri === DATASET) return "/dataset";
  return null;
}

export function shorten(iri: string): string {
  let best = "";
  for (const [prefix, ns] of Object.entries(PREFIXES)) {
    if (iri.startsWith(ns) && ns.length > (best ? PREFIXES[best].length : 0)) best = prefix;
  }
  return best ? `${best}:${iri.slice(PREFIXES[best].length)}` : iri;
}

export function localName(iri: string): string {
  return iri.split(/[/#]/).pop() ?? iri;
}

/** A SPARQL string literal; JSON escaping is valid SPARQL escaping. */
export function lit(value: string): string {
  return JSON.stringify(value);
}

export function isSafeIri(iri: string): boolean {
  return SAFE_IRI.test(iri);
}

export function iriRef(iri: string): string {
  if (!isSafeIri(iri)) throw new Error(`unsafe IRI: ${iri}`);
  return `<${iri}>`;
}

/** Prepend PREFIX declarations for every known prefix the query uses and does not declare itself. */
export function withPrefixes(query: string): string {
  const used = Object.keys(PREFIXES).filter(
    (p) => new RegExp(`(^|[\\s({\\[/^|,;!])${p}:`).test(query) && !new RegExp(`PREFIX\\s+${p}:`, "i").test(query),
  );
  return [...used.map((p) => `PREFIX ${p}: <${PREFIXES[p]}>`), query.trim()].join("\n");
}

/** Link that opens a query in the SPARQL editor. */
export function sparqlHref(query: string): string {
  return `/sparql?q=${encodeURIComponent(withPrefixes(query))}`;
}

export const asNumber = (t?: Term) => (t ? Number(t.value) : undefined);
export const asString = (t?: Term) => t?.value || undefined;
