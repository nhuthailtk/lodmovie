import { statSync } from "node:fs";
import path from "node:path";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import { IriLink } from "@/components/term";
import { ExternalLink, PageHeader, Section, Stat } from "@/components/ui";
import { BASE, DATASET } from "@/lib/config";
import { EXAMPLES } from "@/lib/examples";
import { datasetStats, voidMeta } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

export const metadata = { title: "Dataset" };

const DOWNLOADS = [
  ["all.ttl.gz", "Everything: ontology, data, links and VoID (gzipped Turtle)"],
  ["data.nt", "Instance data — 4★ layer (N-Triples)"],
  ["links.nt", "Links to Wikidata and DBpedia — 5★ layer (N-Triples)"],
  ["ontology.ttl", "Ontology (Turtle)"],
  ["void.ttl", "VoID dataset description (Turtle)"],
] as const;

function size(file: string): string {
  try {
    const bytes = statSync(path.join(process.cwd(), "public", "downloads", file)).size;
    return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
  } catch {
    return "";
  }
}

export default function DatasetPage() {
  const stats = datasetStats();
  const meta = voidMeta();
  const links = stats.linksets.reduce((sum, l) => sum + l.triples, 0);
  const linksQuery = EXAMPLES.find((e) => e.title.includes("5★"))!.query;
  const stars: [string, string, React.ReactNode][] = [
    ["★", "Available on the web under an open licence", <ExternalLink key="1" href={meta.license ?? "#"}>dcterms:license</ExternalLink>],
    ["★★", "Machine-readable structured data", <a key="2" className="link" href="/downloads/all.ttl.gz">all.ttl.gz</a>],
    ["★★★", "Non-proprietary formats: Turtle, N-Triples, JSON-LD, RDF/XML", <a key="3" className="link" href="/data/movie/tt0107290.ttl">/data/movie/tt0107290.ttl</a>],
    ["★★★★", "URIs identify things and dereference (HTTP 303 + content negotiation)", <a key="4" className="link" href="/resource/movie/tt0107290">/resource/movie/tt0107290</a>],
    ["★★★★★", `Linked to other datasets: ${links.toLocaleString("en-US")} links to Wikidata and DBpedia`, <Link key="5" className="link" href={sparqlHref(linksQuery)}>SPARQL over the links graph</Link>],
  ];
  return (
    <div className="space-y-12">
      <PageHeader eyebrow="Dataset" title={meta.title ?? "LOD Movie"}>
        <p>{meta.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{DATASET}</code>
          <CopyButton text={DATASET} />
          <span className="text-slate-500">
            version {meta.version} · modified {meta.modified?.slice(0, 10)}
          </span>
        </div>
      </PageHeader>

      <Section title="5★ Linked Open Data checklist">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {stars.map(([star, text, evidence]) => (
                <tr key={star}>
                  <td className="whitespace-nowrap py-2 pr-4 text-amber-500">{star}</td>
                  <td className="py-2 pr-4">{text}</td>
                  <td className="py-2">{evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Statistics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Triples (data + links)" value={stats.triples} />
          {Object.entries(stats.classes).map(([name, n]) => (
            <Stat key={name} label={name} value={n} />
          ))}
        </div>
      </Section>

      <Section title="Linksets" id="linksets">
        <ul className="space-y-1">
          {stats.linksets.map((l) => (
            <li key={l.target}>
              <IriLink iri={l.target} /> — {l.triples.toLocaleString("en-US")} links
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-500">
          Movies and people use <code>owl:sameAs</code> (matched on IMDb ID, Wikidata P345); genres and professions use{" "}
          <code>skos:exactMatch</code>/<code>skos:closeMatch</code>. {stats.linkedMovies} of {stats.movies} movies are on Wikidata.
        </p>
      </Section>

      <Section title="Downloads">
        <ul className="space-y-2">
          {DOWNLOADS.map(([file, text]) => (
            <li key={file} className="flex flex-wrap items-baseline gap-x-3">
              <a className="link font-mono" href={`/downloads/${file}`}>{file}</a>
              <span className="text-sm text-slate-500">{size(file)}</span>
              <span className="text-sm">{text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Access">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>SPARQL endpoint: <Link className="link" href="/sparql">{BASE}sparql</Link></li>
          <li>This dataset URI returns VoID for RDF clients: <code>curl -H &quot;Accept: text/turtle&quot; {DATASET}</code></li>
          <li>Every resource URI dereferences, e.g. <code>curl -L -H &quot;Accept: application/ld+json&quot; {BASE}resource/movie/tt0107290</code></li>
        </ul>
      </Section>

      <Section title="Provenance and licence">
        <p className="text-sm">
          Source data: the IMDb non-commercial datasets ({meta.sources.length} files). IMDb data may be used for personal and non-commercial
          purposes only. English and Vietnamese titles were translated with Claude Code; links were matched through Wikidata.
        </p>
        <ul className="list-disc pl-5 text-sm">
          {meta.sources.map((s) => <li key={s}><ExternalLink href={s}>{s}</ExternalLink></li>)}
        </ul>
      </Section>
    </div>
  );
}
