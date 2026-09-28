import Link from "next/link";
import MovieCard from "@/components/movie-card";
import { Empty, PageHeader, Section } from "@/components/ui";
import { listMovies, listPeople, parseMovieFilters, parsePeopleFilters, type SearchParams } from "@/lib/queries";
import { pageHref } from "@/lib/rdf";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const movieFilters = parseMovieFilters(sp);
  const q = movieFilters.q;
  const movies = q ? listMovies({ ...movieFilters, page: 1 }, 12) : null;
  const people = q ? listPeople({ ...parsePeopleFilters(sp), page: 1 }, 24) : null;
  const encoded = encodeURIComponent(q);
  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"}>
        <form action="/search" className="flex max-w-xl gap-2">
          <input name="q" defaultValue={q} required placeholder="Search movies and people…" className="input flex-1" />
          <button className="btn-primary">Search</button>
        </form>
      </PageHeader>
      {movies && (
        <Section title={`Movies (${movies.total})`} action={movies.total > 12 && <Link className="link" href={`/movies?q=${encoded}`}>All movie results →</Link>}>
          {movies.rows.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{movies.rows.map((m) => <MovieCard key={m.iri} movie={m} />)}</div>
          ) : (
            <Empty>No movies match.</Empty>
          )}
        </Section>
      )}
      {people && (
        <Section title={`People (${people.total})`} action={people.total > 24 && <Link className="link" href={`/people?q=${encoded}`}>All people results →</Link>}>
          {people.rows.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {people.rows.map((p) => (
                <li key={p.iri}>
                  <Link className="link" href={pageHref(p.iri)!}>{p.label}</Link>
                  <span className="text-sm text-slate-500"> · {p.movies} movie{p.movies === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No people match.</Empty>
          )}
        </Section>
      )}
    </div>
  );
}
