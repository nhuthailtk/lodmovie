import { GRAPH, MO, ONTOLOGY } from "./config";
import { iriRef, localName, shorten } from "./rdf";
import { select } from "./store";

export type TermKind = "Class" | "ObjectProperty" | "DatatypeProperty";
export type OntologyTerm = {
  iri: string;
  name: string;
  kind: TermKind;
  label: string;
  comment?: string;
  functional: boolean;
  relations: Record<string, string[]>;
};
export type DiagramNode = { id: string; label: string; external: boolean; comment?: string; datatypeProps: string[] };
export type DiagramEdge = { id: string; source: string; target: string; label: string; kind: "object" | "subclass" | "equivalent" };

const G = iriRef(GRAPH.ontology);
const OWL = "http://www.w3.org/2002/07/owl#";
export const RELATION_LABELS: Record<string, string> = {
  "rdfs:domain": "Domain",
  "rdfs:range": "Range",
  "rdfs:subClassOf": "Subclass of",
  "rdfs:subPropertyOf": "Subproperty of",
  "owl:equivalentClass": "Equivalent class",
  "owl:inverseOf": "Inverse of",
};

export function ontologyHeader() {
  const rows = select(`SELECT ?p ?o WHERE { GRAPH ${G} { ${iriRef(ONTOLOGY)} ?p ?o } }`);
  const one = (local: string) => rows.find((r) => r.p!.value.endsWith(local))?.o?.value;
  return { title: one("/title"), description: one("/description"), creator: one("/creator"), created: one("/created"), version: one("#versionInfo") };
}

export function ontologyTerms(): OntologyTerm[] {
  const base = select(`SELECT ?term ?kind ?label ?comment WHERE { GRAPH ${G} {
    ?term a ?kind ; rdfs:label ?label .
    OPTIONAL { ?term rdfs:comment ?comment }
    FILTER(?kind IN (owl:Class, owl:ObjectProperty, owl:DatatypeProperty))
    FILTER(STRSTARTS(STR(?term), STR(mo:)))
  } } ORDER BY ?label`);
  const relations = select(`SELECT ?term ?rel ?target WHERE { GRAPH ${G} {
    ?term ?rel ?value .
    FILTER(?rel IN (rdfs:domain, rdfs:range, rdfs:subClassOf, rdfs:subPropertyOf, owl:equivalentClass, owl:inverseOf))
    FILTER(STRSTARTS(STR(?term), STR(mo:)))
    OPTIONAL { ?value owl:unionOf/rdf:rest*/rdf:first ?member }
    BIND(COALESCE(?member, ?value) AS ?target)
    FILTER(isIRI(?target))
  } }`);
  const functional = new Set(select(`SELECT ?term WHERE { GRAPH ${G} { ?term a owl:FunctionalProperty } }`).map((r) => r.term!.value));
  return base.map((row) => {
    const iri = row.term!.value;
    const rels: Record<string, string[]> = {};
    for (const rel of relations.filter((r) => r.term!.value === iri)) {
      const key = shorten(rel.rel!.value);
      const list = (rels[key] ??= []);
      if (!list.includes(rel.target!.value)) list.push(rel.target!.value);
    }
    return {
      iri,
      name: iri.slice(MO.length),
      kind: row.kind!.value.slice(OWL.length) as TermKind,
      label: row.label!.value,
      comment: row.comment?.value,
      functional: functional.has(iri),
      relations: rels,
    };
  });
}

export function ontologyDiagram(terms: OntologyTerm[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes = new Map<string, DiagramNode>();
  const addNode = (iri: string) => {
    if (!nodes.has(iri)) {
      const own = terms.find((t) => t.iri === iri);
      nodes.set(iri, { id: iri, label: own ? own.name : shorten(iri), external: !own, comment: own?.comment, datatypeProps: [] });
    }
    return nodes.get(iri)!;
  };
  const edges: DiagramEdge[] = [];
  for (const term of terms.filter((t) => t.kind === "Class")) {
    addNode(term.iri);
    for (const target of term.relations["rdfs:subClassOf"] ?? []) {
      addNode(target);
      edges.push({ id: `${term.iri}>sub>${target}`, source: term.iri, target, label: "subClassOf", kind: "subclass" });
    }
    for (const target of term.relations["owl:equivalentClass"] ?? []) {
      addNode(target);
      edges.push({ id: `${term.iri}>eq>${target}`, source: term.iri, target, label: "equivalentClass", kind: "equivalent" });
    }
  }
  for (const term of terms.filter((t) => t.kind === "ObjectProperty")) {
    for (const domain of term.relations["rdfs:domain"] ?? []) {
      for (const range of term.relations["rdfs:range"] ?? []) {
        addNode(domain);
        addNode(range);
        edges.push({ id: `${domain}>${term.name}>${range}`, source: domain, target: range, label: term.name, kind: "object" });
      }
    }
  }
  for (const term of terms.filter((t) => t.kind === "DatatypeProperty")) {
    const range = (term.relations["rdfs:range"] ?? []).map((r) => shorten(r)).join(", ");
    for (const domain of term.relations["rdfs:domain"] ?? []) addNode(domain).datatypeProps.push(`${term.name} → ${range || localName(term.iri)}`);
  }
  return { nodes: [...nodes.values()], edges };
}
