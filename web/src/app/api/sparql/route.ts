import { RESULT_LIMIT } from "@/lib/config";
import { runQuery, SparqlError } from "@/lib/sparql";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Expose-Headers": "X-LOD-Result-Limit",
};

function fail(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
}

async function answer(req: Request, query: string | null, params: URLSearchParams): Promise<Response> {
  if (params.has("default-graph-uri") || params.has("named-graph-uri")) {
    return fail(400, "default-graph-uri and named-graph-uri are not supported; use GRAPH <…> in the query (graphs: …/graph/data, …/graph/links, …/graph/ontology, …/graph/void).");
  }
  if (!query?.trim()) return fail(400, "Missing 'query' parameter. Open /sparql in a browser for the query editor.");
  try {
    const result = await runQuery(query, req.headers.get("accept"), params.get("format"));
    const headers: Record<string, string> = {
      ...CORS,
      "Content-Type": `${result.contentType}; charset=utf-8`,
      Vary: "Accept",
    };
    if (result.limited) headers["X-LOD-Result-Limit"] = String(RESULT_LIMIT);
    return new Response(result.body, { headers });
  } catch (error) {
    if (error instanceof SparqlError) return fail(error.status, error.message);
    throw error;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return answer(req, url.searchParams.get("query"), url.searchParams);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/sparql-query") return answer(req, await req.text(), url.searchParams);
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(await req.text());
    for (const [key, value] of url.searchParams) if (!form.has(key)) form.set(key, value);
    return answer(req, form.get("query"), form);
  }
  return fail(415, "POST the query as application/x-www-form-urlencoded (query=…) or as application/sparql-query.");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
