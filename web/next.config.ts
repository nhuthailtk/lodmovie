import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Oxigraph ships a WebAssembly binary; keep it (and sparqljs) as plain Node modules.
  serverExternalPackages: ["oxigraph", "sparqljs"],
  // The RDF files are read from disk at runtime, so every server function must include them.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*"],
    "/**/*": ["./data/**/*"],
    // The SPARQL worker is loaded by path at runtime, so the tracer cannot see it or its oxigraph import.
    "/api/sparql": ["./data/**/*", "./sparql-worker/**/*", "./node_modules/oxigraph/**/*"],
  },
  // Negotiated URLs: the HTML variant must also tell caches that the response depends on Accept.
  async headers() {
    return [{ source: "/:path(ontology|dataset)", headers: [{ key: "Vary", value: "Accept" }] }];
  },
};

export default nextConfig;
