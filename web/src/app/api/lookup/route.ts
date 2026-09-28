import { lookup } from "@/lib/graph";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  return Response.json(q.length < 2 ? [] : lookup(q));
}
