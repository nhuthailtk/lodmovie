import { negotiateRdf } from "@/lib/conneg";
import { exists } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";

/** The Linked Data URI: 303 See Other to the HTML page or to the RDF document ("Cool URIs"). */
export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) {
    return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const ext = negotiateRdf(req.headers.get("accept"));
  const location = ext ? `/data/${type}/${id}.${ext}` : `/page/${type}/${id}`;
  return new Response(null, {
    status: 303,
    headers: { Location: location, Vary: "Accept", "Access-Control-Allow-Origin": "*" },
  });
}
