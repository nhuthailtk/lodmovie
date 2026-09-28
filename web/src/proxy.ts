import { NextResponse, type NextRequest } from "next/server";
import { negotiateRdf } from "@/lib/conneg";

/** One URL, two audiences: /sparql, /ontology and /dataset serve HTML to browsers and RDF or SPARQL results to machines. */
export function proxy(request: NextRequest) {
  const { pathname, searchParams, search } = request.nextUrl;
  if (pathname === "/sparql") {
    if (request.method === "GET" && !searchParams.has("query")) return NextResponse.next();
    return NextResponse.rewrite(new URL(`/api/sparql${search}`, request.url));
  }
  const ext = negotiateRdf(request.headers.get("accept"));
  // The RDF route negotiates the format from the (preserved) Accept header.
  const response = ext ? NextResponse.rewrite(new URL(`/api/rdf${pathname}`, request.url)) : NextResponse.next();
  response.headers.set("Vary", "Accept");
  return response;
}

export const config = { matcher: ["/sparql", "/ontology", "/dataset"] };
