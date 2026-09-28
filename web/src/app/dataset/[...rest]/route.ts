import { DATASET } from "@/lib/config";
import { negotiateRdf, RDF_TYPES } from "@/lib/conneg";
import { describe } from "@/lib/linked-data";

const TAIL = /^(linkset|partition)\/[a-z0-9-]+$/;

/** VoID sub-resources (…/dataset/linkset/wikidata, …/dataset/partition/movie): RDF for machines, 303 to the docs for browsers. */
export async function GET(req: Request, { params }: { params: Promise<{ rest: string[] }> }) {
  const tail = (await params).rest.join("/");
  const ext = negotiateRdf(req.headers.get("accept"));
  const body = TAIL.test(tail) ? describe(`${DATASET}/${tail}`, RDF_TYPES[ext ?? "ttl"]) : null;
  if (body === null) return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!ext) {
    const anchor = tail.startsWith("linkset/") ? "linksets" : "statistics";
    return new Response(null, { status: 303, headers: { Location: `/dataset#${anchor}`, Vary: "Accept" } });
  }
  return new Response(body, {
    headers: { "Content-Type": `${RDF_TYPES[ext]}; charset=utf-8`, Vary: "Accept", "Access-Control-Allow-Origin": "*" },
  });
}
