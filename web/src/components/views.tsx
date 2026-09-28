import Link from "next/link";
import type { ReactNode } from "react";
import CopyButton from "./copy-button";
import MovieCard from "./movie-card";
import { IriLink, TermValue } from "./term";
import { Chip, Empty, ExternalLink, Facts, Section } from "./ui";
import WikidataPanel from "./wikidata-panel";
import type { Named } from "@/lib/queries";
import { pageHref, shorten, sparqlHref } from "@/lib/rdf";
import { wikidataQid, type ConceptView, type CreditRow, type CreditView, type MovieView, type PersonView, type TripleView } from "@/lib/resource";

type Common = { iri: string; type: string; id: string };

const FORMATS = [
  ["ttl", "Turtle"],
  ["jsonld", "JSON-LD"],
  ["nt", "N-Triples"],
  ["rdf", "RDF/XML"],
] as const;

function ResourceHeader({ iri, type, id, kind, title, children }: Common & { kind: string; title: string; children?: ReactNode }) {
  return (
    <header className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{kind}</p>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="break-all rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{iri}</code>
        <CopyButton text={iri} />
      </div>
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(([ext, label]) => (
          <a key={ext} className="btn" href={`/data/${type}/${id}.${ext}`}>{label}</a>
        ))}
        <Link className="btn" href={`/explore?uri=${encodeURIComponent(iri)}`}>Explore graph</Link>
        <Link className="btn" href={sparqlHref(`DESCRIBE <${iri}>`)}>View as SPARQL</Link>
      </div>
    </header>
  );
}

function PeopleLinks({ people }: { people: Named[] }) {
  if (!people.length) return <span className="text-slate-500">—</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {people.map((p) => <IriLink key={p.iri} iri={p.iri} label={p.label} />)}
    </span>
  );
}

function LinkedData({ links, imdb }: { links: string[]; imdb: string }) {
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold">Linked data</h2>
      <ul className="space-y-1 text-sm">
        {links.map((link) => (
          <li key={link}>
            <span className="text-slate-500">owl:sameAs </span>
            <ExternalLink href={link}>{shorten(link)}</ExternalLink>
          </li>
        ))}
        <li>
          <span className="text-slate-500">rdfs:seeAlso </span>
          <ExternalLink href={imdb}>IMDb</ExternalLink>
        </li>
      </ul>
      {!links.length && <p className="text-sm text-slate-500">No Wikidata item has this IMDb ID yet.</p>}
    </div>
  );
}

function CreditTable({ rows, cast }: { rows: CreditRow[]; cast?: boolean }) {
  if (!rows.length) return <Empty>None listed.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Person</th>
            <th className="py-2 pr-4">{cast ? "Character" : "Role"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((c) => (
            <tr key={c.iri}>
              <td className="py-2 pr-4 tabular-nums"><IriLink iri={c.iri} label={String(c.order)} /></td>
              <td className="py-2 pr-4"><IriLink iri={c.person.iri} label={c.person.label} /></td>
              <td className="py-2 pr-4">
                {cast ? c.characters || "—" : [c.role, c.job && c.job !== c.role ? c.job : null].filter(Boolean).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MovieDetail({ m, ...common }: Common & { m: MovieView }) {
  const title = m.en ?? m.primaryTitle;
  const qid = wikidataQid(m.sameAs);
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Movie" title={title}>
        {m.vi && <p className="text-lg">Vietnamese title: <span className="font-medium">{m.vi}</span></p>}
        {m.originalTitle && m.originalTitle !== title && <p className="text-slate-600 dark:text-slate-300">Original title: {m.originalTitle}</p>}
      </ResourceHeader>
      <Facts
        items={[
          ["Year", m.year ?? "—"],
          ["Runtime", m.runtime ? `${m.runtime} min` : "—"],
          ["IMDb rating", m.rating !== undefined ? `★ ${m.rating.toFixed(1)}` : "—"],
          ["Votes", m.votes?.toLocaleString("en-US") ?? "—"],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {m.genres.map((g) => <Chip key={g.iri} href={pageHref(g.iri)!}>{g.label}</Chip>)}
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Directed and written by">
            <dl className="space-y-2">
              <div className="flex gap-3"><dt className="w-24 text-slate-500">Directors</dt><dd><PeopleLinks people={m.directors} /></dd></div>
              <div className="flex gap-3"><dt className="w-24 text-slate-500">Writers</dt><dd><PeopleLinks people={m.writers} /></dd></div>
            </dl>
          </Section>
          <Section title={`Cast (${m.cast.length})`}><CreditTable rows={m.cast} cast /></Section>
          <Section title={`Crew (${m.crew.length})`}><CreditTable rows={m.crew} /></Section>
        </div>
        <div className="space-y-6">
          {qid && <WikidataPanel qid={qid} kind="movie" subject={m.iri} />}
          <LinkedData links={m.sameAs} imdb={`https://www.imdb.com/title/${m.imdbId}/`} />
        </div>
      </div>
    </div>
  );
}

export function PersonDetail({ p, ...common }: Common & { p: PersonView }) {
  const qid = wikidataQid(p.sameAs);
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Person" title={p.name} />
      <Facts
        items={[
          ["Born", p.birthYear ?? "—"],
          ["Died", p.deathYear ?? "—"],
          ["Movies here", p.films.length],
          ["IMDb", <ExternalLink key="imdb" href={`https://www.imdb.com/name/${p.imdbId}/`}>{p.imdbId}</ExternalLink>],
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {p.professions.map((x) => <Chip key={x.iri} href={pageHref(x.iri)!}>{x.label}</Chip>)}
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <Section title="Filmography in this dataset">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="py-2 pr-4">Year</th><th className="py-2 pr-4">Movie</th><th className="py-2 pr-4">Roles</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {p.films.map((f) => (
                    <tr key={f.movie.iri}>
                      <td className="py-2 pr-4 tabular-nums text-slate-500">{f.year ?? "—"}</td>
                      <td className="py-2 pr-4"><IriLink iri={f.movie.iri} label={f.movie.label} /></td>
                      <td className="py-2 pr-4">{f.roles.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {p.knownFor.length > 0 && (
            <Section title="Known for (in this dataset)">
              <div className="flex flex-wrap gap-2">{p.knownFor.map((k) => <Chip key={k.iri} href={pageHref(k.iri)!}>{k.label}</Chip>)}</div>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          {qid && <WikidataPanel qid={qid} kind="person" subject={p.iri} />}
          <LinkedData links={p.sameAs} imdb={`https://www.imdb.com/name/${p.imdbId}/`} />
        </div>
      </div>
    </div>
  );
}

export function ConceptDetail({ c, ...common }: Common & { c: ConceptView }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind={c.kind === "genre" ? "Genre" : "Profession"} title={c.label}>
        {c.isTarget && <p className="text-slate-600 dark:text-slate-300">One of the six genres the dataset was sampled from.</p>}
      </ResourceHeader>
      <Section title="Matches in other datasets">
        {c.matches.length ? (
          <ul className="space-y-1 text-sm">
            {c.matches.map((m) => (
              <li key={m.iri}>
                <span className="text-slate-500">{m.exact ? "skos:exactMatch" : "skos:closeMatch"} </span>
                <ExternalLink href={m.iri}>{shorten(m.iri)}</ExternalLink>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Deliberately not mapped (too vague to match a Wikidata item).</Empty>
        )}
      </Section>
      {c.kind === "genre" && (
        <Section title={`Movies (${c.movies.length})`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{c.movies.map((m) => <MovieCard key={m.iri} movie={m} />)}</div>
        </Section>
      )}
      {c.kind === "profession" && (
        <Section title={`People (${c.peopleTotal.toLocaleString("en-US")})`}>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {c.people.map((p) => <li key={p.iri} className="truncate"><IriLink iri={p.iri} label={p.label} /></li>)}
          </ul>
          {c.peopleTotal > c.people.length && <p className="text-sm text-slate-500">Showing the first {c.people.length}.</p>}
        </Section>
      )}
    </div>
  );
}

export function CreditDetail({ c, ...common }: Common & { c: CreditView }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Credit" title={`${c.person.label} — ${c.role}`}>
        <p className="text-slate-600 dark:text-slate-300">
          A <IriLink iri="https://lod-movie.felix-nguyen.io.vn/ontology#Credit" label="mo:Credit" /> node links a movie, a person and a role.
        </p>
      </ResourceHeader>
      <Facts
        items={[
          ["Movie", <IriLink key="m" iri={c.movie.iri} label={c.movie.label} />],
          ["Person", <IriLink key="p" iri={c.person.iri} label={c.person.label} />],
          ["Role", c.role],
          ["Billing order", c.order],
        ]}
      />
      {(c.job || c.characters.length > 0) && (
        <Section title="Details">
          {c.job && <p>Job: {c.job}</p>}
          {c.characters.length > 0 && <p>Characters: {c.characters.join(", ")}</p>}
        </Section>
      )}
    </div>
  );
}

export function GenericDetail({ t, title, ...common }: Common & { t: TripleView; title: string }) {
  return (
    <div className="space-y-10">
      <ResourceHeader {...common} kind="Resource" title={title} />
      <Section title="Outgoing triples">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {t.outgoing.map((x, i) => (
              <tr key={i}><td className="py-2 pr-4 align-top"><TermValue term={x.p} /></td><td className="py-2"><TermValue term={x.o} /></td></tr>
            ))}
          </tbody>
        </table>
      </Section>
      {t.incoming.length > 0 && (
        <Section title="Incoming triples">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {t.incoming.map((x, i) => (
                <tr key={i}><td className="py-2 pr-4"><TermValue term={x.s} /></td><td className="py-2"><TermValue term={x.p} /></td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
