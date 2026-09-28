export const RDF_TYPES = {
  ttl: "text/turtle",
  jsonld: "application/ld+json",
  nt: "application/n-triples",
  rdf: "application/rdf+xml",
} as const;
export type RdfExt = keyof typeof RDF_TYPES;

export type Accepted = { type: string; q: number };

const HTML = new Set(["text/html", "application/xhtml+xml"]);

export function isRdfExt(ext: string): ext is RdfExt {
  return Object.hasOwn(RDF_TYPES, ext);
}

export function parseAccept(header: string | null): Accepted[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [type, ...params] = part.trim().toLowerCase().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { type: type.trim(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((a) => a.type && a.q > 0);
}

/** The RDF format the client prefers, or null when it should get HTML. At equal q, HTML wins. */
export function negotiateRdf(header: string | null): RdfExt | null {
  const accepted = parseAccept(header);
  const levels = [...new Set(accepted.map((a) => a.q))].sort((a, b) => b - a);
  for (const q of levels) {
    const group = accepted.filter((a) => a.q === q).map((a) => a.type);
    if (group.some((type) => HTML.has(type))) return null;
    const rdf = (Object.entries(RDF_TYPES) as [RdfExt, string][]).find(([, type]) => group.includes(type));
    if (rdf) return rdf[0];
    if (group.some((type) => type === "*/*" || type === "text/*")) return null;
  }
  return null;
}
