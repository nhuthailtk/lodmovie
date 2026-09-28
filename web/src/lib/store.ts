import { readFileSync } from "node:fs";
import path from "node:path";
import oxigraph from "oxigraph";
import { GRAPH } from "./config";
import { withPrefixes, type Row, type Term } from "./rdf";

const FILES = [
  ["data.nt", "application/n-triples", GRAPH.data],
  ["links.nt", "application/n-triples", GRAPH.links],
  ["ontology.ttl", "text/turtle", GRAPH.ontology],
  ["void.ttl", "text/turtle", GRAPH.void],
] as const;

const OPTIONS = { use_default_graph_as_union: true };

let store: oxigraph.Store | null = null;

/** The whole dataset in one in-memory Oxigraph store, one named graph per dist file. */
export function getStore(): oxigraph.Store {
  if (store) return store;
  const loaded = new oxigraph.Store();
  const dir = path.join(process.cwd(), "data");
  for (const [file, format, graph] of FILES) {
    loaded.load(readFileSync(path.join(dir, file), "utf8"), { format, to_graph_name: oxigraph.namedNode(graph) });
  }
  store = loaded;
  return store;
}

function toTerm(term: oxigraph.Term): Term {
  if (term.termType === "NamedNode") return { type: "uri", value: term.value };
  if (term.termType === "Literal") {
    return { type: "literal", value: term.value, lang: term.language || undefined, datatype: term.datatype.value };
  }
  return { type: "bnode", value: term.value };
}

export function select(query: string): Row[] {
  const rows = getStore().query(withPrefixes(query), OPTIONS) as Map<string, oxigraph.Term>[];
  return rows.map((binding) => Object.fromEntries([...binding.entries()].map(([name, term]) => [name, toTerm(term)])));
}

export function ask(query: string): boolean {
  return getStore().query(withPrefixes(query), OPTIONS) as boolean;
}

export function serialize(query: string, format: string): string {
  return getStore().query(withPrefixes(query), { ...OPTIONS, results_format: format }) as string;
}
