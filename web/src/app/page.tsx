import Link from "next/link";
import { Stat } from "@/components/ui";
import { EXAMPLES } from "@/lib/examples";
import { datasetStats } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

const FEATURES = [
  ["/movies", "Browse movies", "Filter by genre, year and rating; every list is a SPARQL query you can open."],
  ["/people", "Browse people", "Actors, directors, writers and crew with their filmographies."],
  ["/sparql", "SPARQL endpoint", "A public SPARQL 1.1 endpoint with an editor and example queries."],
  ["/explore", "Explore the graph", "Start from a movie and expand the triples around it, node by node."],
  ["/ontology", "Ontology", "Classes and properties of the LOD Movie vocabulary, as a diagram."],
  ["/dataset", "Dataset & 5★", "VoID description, statistics, downloads and the 5-star checklist."],
] as const;

export default function Home() {
  const s = datasetStats();
  const links = s.linksets.reduce((sum, l) => sum + l.triples, 0);
  const example = EXAMPLES[0];
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Movies as Linked Open Data</h1>
        <p className="max-w-3xl text-lg text-slate-600 dark:text-slate-300">
          {s.movies} IMDb movies (1980–2025) with their cast, crew, genres and credits — published as 5★ Linked Data with English and
          Vietnamese titles, linked to Wikidata and DBpedia, and queryable through a public SPARQL endpoint.
        </p>
        <form action="/search" className="flex max-w-xl gap-2">
          <input name="q" required placeholder="Search movies and people…" className="input flex-1" />
          <button className="btn-primary">Search</button>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Movies" value={s.classes.Movie ?? 0} href="/movies" />
        <Stat label="People" value={s.classes.Person ?? 0} href="/people" />
        <Stat label="Credits" value={s.classes.Credit ?? 0} />
        <Stat label="Triples" value={s.triples} href="/dataset" />
        <Stat label="External links" value={links} href="/dataset#linksets" />
        <Stat label="Movies on Wikidata" value={`${Math.round((100 * s.linkedMovies) / Math.max(1, s.movies))}%`} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([href, title, text]) => (
          <Link key={href} href={href} className="card block space-y-1 hover:border-indigo-400">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>
          </Link>
        ))}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Try a query: {example.title}</h2>
          <Link className="btn-primary" href={sparqlHref(example.query)}>Run it in the editor</Link>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900">{example.query}</pre>
      </section>
    </div>
  );
}
