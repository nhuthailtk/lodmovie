import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Oxigraph ships a WebAssembly binary; keep it (and sparqljs) as plain Node modules.
  serverExternalPackages: ["oxigraph", "sparqljs"],
  // The RDF files are read from disk at runtime, so every server function must include them.
  outputFileTracingIncludes: { "/*": ["./data/**/*"], "/**/*": ["./data/**/*"] },
};

export default nextConfig;
