import { MO, RESOURCE } from "./config";
import { iriRef, lit, localName, pageHref, shorten, type Row, type Term } from "./rdf";
import { select } from "./store";

export type GraphNode = { id: string; label: string; kind: "resource" | "external" | "literal"; cls: string; href?: string };
export type GraphEdge = { id: string; source: string; target: string; label: string };

const CLASSES = ["Movie", "Person", "Credit", "Genre", "Profession"];
const truncate = (text: string, n = 38) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

type Grouped = { term: Term; p: string; labels: Term[]; types: string[] };

function group(rows: Row[], key: "o" | "s"): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const row of rows) {
    const term = row[key]!;
    const id = `${row.p!.value} ${term.type} ${term.value} ${term.lang ?? ""}`;
    const entry = map.get(id) ?? { term, p: row.p!.value, labels: [], types: [] };
    if (row.label) entry.labels.push(row.label);
    if (row.type && !entry.types.includes(row.type.value)) entry.types.push(row.type.value);
    map.set(id, entry);
  }
  return [...map.values()];
}

function rank(n: Grouped): number {
  if (n.p === `${MO}hasCredit`) return 2;
  return n.term.type === "literal" ? 1 : 0;
}

function bestLabel(labels: Term[]): string | undefined {
  return (labels.find((l) => l.lang === "en") ?? labels.find((l) => !l.lang) ?? labels[0])?.value;
}

function classOf(iri: string, types: string[]): string {
  if (iri.startsWith(MO)) return "Ontology";
  for (const type of types) if (type.startsWith(MO) && CLASSES.includes(type.slice(MO.length))) return type.slice(MO.length);
  return "Other";
}

function resourceNode(iri: string, labels: Term[], types: string[]): GraphNode {
  const internal = iri.startsWith(RESOURCE) || iri.startsWith(MO);
  const label = bestLabel(labels) ?? (iri.startsWith(RESOURCE) ? localName(iri) : shorten(iri));
  return { id: iri, label: truncate(label), kind: internal ? "resource" : "external", cls: classOf(iri, types), href: pageHref(iri) ?? iri };
}

/** A resource and up to `max` of its neighbours (outgoing first, then incoming). */
export function neighbors(iri: string, max = 50): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const r = iriRef(iri);
  const self = select(`SELECT ?label ?type WHERE { OPTIONAL { ${r} rdfs:label|skos:prefLabel ?label } OPTIONAL { ${r} a ?type } }`);
  const nodes = new Map<string, GraphNode>();
  nodes.set(iri, resourceNode(iri, self.flatMap((x) => (x.label ? [x.label] : [])), self.flatMap((x) => (x.type ? [x.type.value] : []))));
  const edges: GraphEdge[] = [];

  const out = group(
    select(`SELECT ?p ?o ?label ?type WHERE { ${r} ?p ?o . OPTIONAL { ?o rdfs:label|skos:prefLabel ?label } OPTIONAL { ?o a ?type } } LIMIT 400`),
    "o",
  )
    // Links to other resources (incl. owl:sameAs) first, literals next, the many credit nodes last.
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, Math.ceil(max * 0.7));
  for (const n of out) {
    if (n.term.type === "literal") {
      const id = `literal:${iri}|${n.p}|${n.term.value}|${n.term.lang ?? ""}`;
      nodes.set(id, { id, label: truncate(n.term.value + (n.term.lang ? ` @${n.term.lang}` : "")), kind: "literal", cls: "Literal" });
      edges.push({ id: `${iri}|${n.p}|${id}`, source: iri, target: id, label: shorten(n.p) });
    } else if (n.term.type === "uri") {
      if (!nodes.has(n.term.value)) nodes.set(n.term.value, resourceNode(n.term.value, n.labels, n.types));
      edges.push({ id: `${iri}|${n.p}|${n.term.value}`, source: iri, target: n.term.value, label: shorten(n.p) });
    }
  }

  const incoming = group(
    select(`SELECT ?s ?p ?label ?type WHERE { ?s ?p ${r} . OPTIONAL { ?s rdfs:label|skos:prefLabel ?label } OPTIONAL { ?s a ?type } } LIMIT 400`),
    "s",
  ).slice(0, Math.max(0, max - out.length));
  for (const n of incoming) {
    if (n.term.type !== "uri") continue;
    if (!nodes.has(n.term.value)) nodes.set(n.term.value, resourceNode(n.term.value, n.labels, n.types));
    edges.push({ id: `${n.term.value}|${n.p}|${iri}`, source: n.term.value, target: iri, label: shorten(n.p) });
  }
  return { nodes: [...nodes.values()], edges };
}

export function lookup(q: string): { iri: string; label: string; kind: string }[] {
  const seen = new Set<string>();
  return select(`SELECT ?iri ?label ?type WHERE {
    VALUES ?type { mo:Movie mo:Person }
    ?iri a ?type ; rdfs:label ?label .
    FILTER(CONTAINS(LCASE(?label), ${lit(q.toLowerCase())}))
  } LIMIT 30`)
    .filter((r) => !seen.has(r.iri!.value) && seen.add(r.iri!.value))
    .slice(0, 10)
    .map((r) => ({ iri: r.iri!.value, label: r.label!.value, kind: localName(r.type!.value) }));
}
