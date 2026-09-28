import Link from "next/link";
import MovieCard from "@/components/movie-card";
import Pagination from "@/components/pagination";
import { Empty, PageHeader } from "@/components/ui";
import { genreOptions, listMovies, MOVIES_PER_PAGE, parseMovieFilters, type SearchParams } from "@/lib/queries";
import { sparqlHref } from "@/lib/rdf";

export const metadata = { title: "Movies" };

export default async function MoviesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseMovieFilters(await searchParams);
  const { rows, total, query } = listMovies(f);
  const genres = genreOptions();
  const params = {
    q: f.q,
    genre: f.genre,
    from: f.from?.toString() ?? "",
    to: f.to?.toString() ?? "",
    rating: f.rating?.toString() ?? "",
    sort: f.sort,
  };
  return (
    <div>
      <PageHeader eyebrow="Browse" title="Movies">
        <p>
          {total} movies match. Every list on this site is a SPARQL query over the dataset —{" "}
          <Link className="link" href={sparqlHref(query)}>open this one in the editor</Link>.
        </p>
      </PageHeader>
      <form action="/movies" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input name="q" defaultValue={f.q} placeholder="Title (English, Vietnamese or original)" className="input lg:col-span-2" />
        <select name="genre" defaultValue={f.genre} className="input">
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.slug} value={g.slug}>{g.label} ({g.count})</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input name="from" type="number" min={1900} max={2100} placeholder="From" defaultValue={f.from} className="input w-full" />
          <input name="to" type="number" min={1900} max={2100} placeholder="To" defaultValue={f.to} className="input w-full" />
        </div>
        <select name="rating" defaultValue={f.rating?.toString() ?? ""} className="input">
          <option value="">Any rating</option>
          {[5, 6, 7, 8].map((r) => (
            <option key={r} value={r}>★ {r}+</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={f.sort} className="input w-full">
            <option value="rating">Top rated</option>
            <option value="votes">Most votes</option>
            <option value="year">Newest</option>
            <option value="title">Title A–Z</option>
          </select>
          <button className="btn-primary">Apply</button>
        </div>
      </form>
      {rows.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((m) => <MovieCard key={m.iri} movie={m} />)}
        </div>
      ) : (
        <Empty>
          No movies match these filters. <Link className="link" href="/movies">Reset filters</Link>
        </Empty>
      )}
      <div className="mt-8">
        <Pagination page={f.page} total={total} perPage={MOVIES_PER_PAGE} basePath="/movies" params={params} />
      </div>
    </div>
  );
}
