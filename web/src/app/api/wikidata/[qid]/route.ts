import { wikidataFacts, type WikidataKind } from "@/lib/wikidata";

export async function GET(req: Request, { params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  const kind: WikidataKind = new URL(req.url).searchParams.get("kind") === "person" ? "person" : "movie";
  if (!/^Q\d+$/.test(qid)) return Response.json({ error: "Invalid Wikidata ID" }, { status: 400 });
  try {
    return Response.json(await wikidataFacts(qid, kind), {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return Response.json({ error: "Wikidata is not reachable right now." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
