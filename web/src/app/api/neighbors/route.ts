import { neighbors } from "@/lib/graph";
import { isSafeIri } from "@/lib/rdf";

export async function GET(req: Request) {
  const uri = new URL(req.url).searchParams.get("uri") ?? "";
  if (!isSafeIri(uri)) return Response.json({ error: "Invalid uri" }, { status: 400 });
  return Response.json(neighbors(uri));
}
