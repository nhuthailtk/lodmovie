import Link from "next/link";
import Pagination from "@/components/pagination";
import { Empty, PageHeader } from "@/components/ui";
import { listPeople, parsePeopleFilters, PEOPLE_PER_PAGE, professionOptions, type SearchParams } from "@/lib/queries";
import { pageHref, sparqlHref } from "@/lib/rdf";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parsePeopleFilters(await searchParams);
  const { rows, total, query } = listPeople(f);
  const professions = professionOptions();
  const params = { q: f.q, profession: f.profession, sort: f.sort };
  return (
    <div>
      <PageHeader eyebrow="Browse" title="People">
        <p>
          {total.toLocaleString("en-US")} people match —{" "}
          <Link className="link" href={sparqlHref(query)}>open this query in the editor</Link>.
        </p>
      </PageHeader>
      <form action="/people" className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input name="q" defaultValue={f.q} placeholder="Name" className="input lg:col-span-2" />
        <select name="profession" defaultValue={f.profession} className="input">
          <option value="">All professions</option>
          {professions.map((p) => (
            <option key={p.slug} value={p.slug}>{p.label} ({p.count})</option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="sort" defaultValue={f.sort} className="input w-full">
            <option value="movies">Most movies</option>
            <option value="name">Name A–Z</option>
          </select>
          <button className="btn-primary">Apply</button>
        </div>
      </form>
      {rows.length ? (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((p) => (
            <li key={p.iri} className="truncate">
              <Link className="link" href={pageHref(p.iri)!}>{p.label}</Link>
              <span className="text-sm text-slate-500"> · {p.movies}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          No people match. <Link className="link" href="/people">Reset filters</Link>
        </Empty>
      )}
      <div className="mt-8">
        <Pagination page={f.page} total={total} perPage={PEOPLE_PER_PAGE} basePath="/people" params={params} />
      </div>
    </div>
  );
}
