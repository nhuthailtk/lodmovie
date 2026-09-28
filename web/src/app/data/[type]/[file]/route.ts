import { isRdfExt, RDF_TYPES } from "@/lib/conneg";
import { describe } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";

const notFound = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** The RDF document describing one resource, e.g. /data/movie/tt0107290.ttl */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string; file: string }> }) {
  const { type, file } = await params;
  const dot = file.lastIndexOf(".");
  const ext = file.slice(dot + 1);
  const iri = dot > 0 ? resourceIri(type, file.slice(0, dot)) : null;
  if (!iri || !isRdfExt(ext)) return notFound();
  const body = describe(iri, RDF_TYPES[ext]);
  if (body === null) return notFound();
  return new Response(body, {
    headers: { "Content-Type": `${RDF_TYPES[ext]}; charset=utf-8`, "Access-Control-Allow-Origin": "*" },
  });
}
