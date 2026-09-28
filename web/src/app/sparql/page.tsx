import SparqlEditor from "@/components/sparql-editor";
import { PageHeader } from "@/components/ui";
import { BASE, GRAPH, RESULT_LIMIT } from "@/lib/config";
import { EXAMPLES } from "@/lib/examples";
import { withPrefixes } from "@/lib/rdf";

export const metadata = { title: "SPARQL endpoint" };

export default function SparqlPage() {
  const endpoint = `${BASE}sparql`;
  const examples = EXAMPLES.map((example) => ({ ...example, query: withPrefixes(example.query) }));
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Query" title="SPARQL endpoint">
        <p>
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{endpoint}</code> is a public, read-only SPARQL 1.1 endpoint (GET or POST).
          SELECT/ASK results come as JSON, XML, CSV or TSV; CONSTRUCT/DESCRIBE as Turtle, JSON-LD, N-Triples or RDF/XML — chosen by the
          <code> Accept</code> header or a <code>format</code> parameter.
        </p>
        <p className="text-sm">
          Results are capped at {RESULT_LIMIT.toLocaleString("en-US")} rows and queries stop after 10 seconds. Named graphs:{" "}
          {Object.values(GRAPH).map((g) => <code key={g} className="mr-2">&lt;{g}&gt;</code>)}
        </p>
      </PageHeader>
      <SparqlEditor examples={examples} />
      <section className="card space-y-2">
        <h2 className="font-semibold">From the command line</h2>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900">{`curl -H "Accept: text/csv" \\
  --data-urlencode "query=SELECT ?movie ?title WHERE { ?movie a <https://lod-movie.felix-nguyen.io.vn/ontology#Movie> ; <http://www.w3.org/2000/01/rdf-schema#label> ?title } LIMIT 5" \\
  ${endpoint}`}</pre>
      </section>
    </div>
  );
}
