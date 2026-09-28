import { readFileSync } from "node:fs";
import path from "node:path";
import oxigraph from "oxigraph";
import { GRAPH } from "@/lib/config";
import { isRdfExt, negotiateRdf, RDF_TYPES } from "@/lib/conneg";
import { getStore } from "@/lib/store";

const DOCS = {
  ontology: { graph: GRAPH.ontology, file: "ontology.ttl" },
  dataset: { graph: GRAPH.void, file: "void.ttl" },
} as const;

/** RDF for the ontology and dataset URIs; reached through the proxy when a client asks for RDF. */
export async function GET(req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  // Proxy rewrites keep headers but not the query string, so negotiate here; ?format= is for direct links.
  const format = new URL(req.url).searchParams.get("format") ?? negotiateRdf(req.headers.get("accept")) ?? "ttl";
  if (!Object.hasOwn(DOCS, doc) || !isRdfExt(format)) return new Response("Not found\n", { status: 404 });
  const { graph, file } = DOCS[doc as keyof typeof DOCS];
  const body =
    format === "ttl"
      ? readFileSync(path.join(process.cwd(), "data", file), "utf8")
      : getStore().dump({ format: RDF_TYPES[format], from_graph_name: oxigraph.namedNode(graph) });
  return new Response(body, {
    headers: {
      "Content-Type": `${RDF_TYPES[format]}; charset=utf-8`,
      Vary: "Accept",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
