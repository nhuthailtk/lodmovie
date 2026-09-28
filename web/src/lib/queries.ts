import { DATASET, GRAPH } from "./config";
import { asNumber, asString, iriRef, lit, localName, withPrefixes, type Row } from "./rdf";
import { select } from "./store";

export type SearchParams = Record<string, string | string[] | undefined>;
export type Named = { iri: string; label: string };
export type MovieCard = { iri: string; title: string; vi?: string; year?: number; rating?: number; genres?: string };
export type PersonCard = Named & { movies: number };

export const MOVIES_PER_PAGE = 24;
export const PEOPLE_PER_PAGE = 48;

const MOVIE_SORTS = {
  rating: "DESC(?rating) DESC(?votes)",
  votes: "DESC(?votes)",
  year: "DESC(?year) ?title",
  title: "?title",
} as const;
export type MovieSort = keyof typeof MOVIE_SORTS;
export type MovieFilters = { q: string; genre: string; from?: number; to?: number; rating?: number; sort: MovieSort; page: number };
export type PeopleFilters = { q: string; profession: string; sort: "movies" | "name"; page: number };

const SLUG = /^[a-z0-9-]*$/;

function param(sp: SearchParams, key: string): string {
  const value = sp[key];
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function numberParam(sp: SearchParams, key: string): number | undefined {
  const raw = param(sp, key);
  const value = Number(raw);
  return raw && Number.isFinite(value) ? value : undefined;
}

function pageParam(sp: SearchParams): number {
  return Math.max(1, Math.floor(numberParam(sp, "page") ?? 1));
}

export function parseMovieFilters(sp: SearchParams): MovieFilters {
  const sort = param(sp, "sort");
  const genre = param(sp, "genre");
  return {
    q: param(sp, "q").slice(0, 100),
    genre: SLUG.test(genre) ? genre : "",
    from: numberParam(sp, "from"),
    to: numberParam(sp, "to"),
    rating: numberParam(sp, "rating"),
    sort: Object.hasOwn(MOVIE_SORTS, sort) ? (sort as MovieSort) : "rating",
    page: pageParam(sp),
  };
}

export function parsePeopleFilters(sp: SearchParams): PeopleFilters {
  const profession = param(sp, "profession");
  return {
    q: param(sp, "q").slice(0, 100),
    profession: SLUG.test(profession) ? profession : "",
    sort: param(sp, "sort") === "name" ? "name" : "movies",
    page: pageParam(sp),
  };
}

export function toCard(row: Row): MovieCard {
  return {
    iri: row.iri!.value,
    title: row.title!.value,
    vi: asString(row.vi),
    year: asNumber(row.year),
    rating: asNumber(row.rating),
    genres: asString(row.genres),
  };
}

function movieWhere(f: MovieFilters): string {
  const lines = ["?iri a mo:Movie ; mo:primaryTitle ?pt ."];
  if (f.genre) lines.push(`?iri mo:hasGenre genre:${f.genre} .`);
  if (f.q) {
    lines.push(
      `FILTER EXISTS { ?iri rdfs:label|mo:primaryTitle|mo:originalTitle ?text . FILTER(CONTAINS(LCASE(STR(?text)), ${lit(f.q.toLowerCase())})) }`,
    );
  }
  lines.push("OPTIONAL { ?iri mo:releaseYear ?year }", "OPTIONAL { ?iri mo:averageRating ?rating }", "OPTIONAL { ?iri mo:numVotes ?votes }");
  if (f.from !== undefined) lines.push(`FILTER(?year >= ${Math.trunc(f.from)})`);
  if (f.to !== undefined) lines.push(`FILTER(?year <= ${Math.trunc(f.to)})`);
  if (f.rating !== undefined) lines.push(`FILTER(?rating >= ${f.rating})`);
  return lines.map((line) => `  ${line}`).join("\n");
}

export function listMovies(f: MovieFilters, limit = MOVIES_PER_PAGE) {
  const query = withPrefixes(`SELECT ?iri ?title ?vi ?year ?rating ?votes (GROUP_CONCAT(DISTINCT ?genreLabel; separator=", ") AS ?genres) WHERE {
${movieWhere(f)}
  OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?iri rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
  OPTIONAL { ?iri mo:hasGenre/skos:prefLabel ?genreLabel }
  BIND(COALESCE(?en, ?pt) AS ?title)
}
GROUP BY ?iri ?title ?vi ?year ?rating ?votes
ORDER BY ${MOVIE_SORTS[f.sort]}
LIMIT ${limit} OFFSET ${(f.page - 1) * limit}`);
  const total = Number(select(`SELECT (COUNT(DISTINCT ?iri) AS ?n) WHERE {\n${movieWhere(f)}\n}`)[0]?.n?.value ?? 0);
  return { rows: select(query).map(toCard), total, query };
}

function peopleWhere(f: PeopleFilters): string {
  const lines = ["?iri a mo:Person ; rdfs:label ?label ."];
  if (f.profession) lines.push(`?iri mo:primaryProfession profession:${f.profession} .`);
  if (f.q) lines.push(`FILTER(CONTAINS(LCASE(?label), ${lit(f.q.toLowerCase())}))`);
  return lines.map((line) => `  ${line}`).join("\n");
}

export function listPeople(f: PeopleFilters, limit = PEOPLE_PER_PAGE) {
  const order = f.sort === "name" ? "?label" : "DESC(?movies) ?label";
  const query = withPrefixes(`SELECT ?iri ?label (COUNT(DISTINCT ?movie) AS ?movies) WHERE {
${peopleWhere(f)}
  OPTIONAL { ?movie mo:hasActor|mo:directedBy|mo:writtenBy|mo:hasCredit/mo:creditedPerson ?iri }
}
GROUP BY ?iri ?label
ORDER BY ${order}
LIMIT ${limit} OFFSET ${(f.page - 1) * limit}`);
  const total = Number(select(`SELECT (COUNT(?iri) AS ?n) WHERE {\n${peopleWhere(f)}\n}`)[0]?.n?.value ?? 0);
  const rows: PersonCard[] = select(query).map((r) => ({ iri: r.iri!.value, label: r.label!.value, movies: Number(r.movies!.value) }));
  return { rows, total, query };
}

function options(query: string) {
  return select(query).map((r) => ({ slug: localName(r.iri!.value), label: r.label!.value, count: Number(r.n!.value) }));
}

export function genreOptions() {
  return options(`SELECT ?iri ?label (COUNT(DISTINCT ?m) AS ?n) WHERE { ?iri a mo:Genre ; skos:prefLabel ?label . ?m mo:hasGenre ?iri } GROUP BY ?iri ?label ORDER BY ?label`);
}

export function professionOptions() {
  return options(`SELECT ?iri ?label (COUNT(DISTINCT ?p) AS ?n) WHERE { ?iri a mo:Profession ; skos:prefLabel ?label . ?p mo:primaryProfession ?iri } GROUP BY ?iri ?label ORDER BY DESC(?n)`);
}

const VOID_G = iriRef(GRAPH.void);
const DS = iriRef(DATASET);

export function datasetStats() {
  const classes: Record<string, number> = Object.fromEntries(
    select(`SELECT ?class ?n WHERE { GRAPH ${VOID_G} { ${DS} void:classPartition ?part . ?part void:class ?class ; void:entities ?n } }`).map(
      (r) => [localName(r.class!.value), Number(r.n!.value)],
    ),
  );
  const triples = Number(select(`SELECT ?n WHERE { GRAPH ${VOID_G} { ${DS} void:triples ?n } }`)[0]?.n?.value ?? 0);
  const linksets = select(
    `SELECT ?target ?n WHERE { GRAPH ${VOID_G} { ${DS} void:subset ?ls . ?ls void:objectsTarget ?target ; void:triples ?n } } ORDER BY ?target`,
  ).map((r) => ({ target: r.target!.value, triples: Number(r.n!.value) }));
  const linkedMovies = Number(
    select(`SELECT (COUNT(DISTINCT ?m) AS ?n) WHERE { ?m a mo:Movie ; owl:sameAs ?x . FILTER(STRSTARTS(STR(?x), STR(wd:))) }`)[0]?.n?.value ?? 0,
  );
  return { classes, triples, linksets, linkedMovies, movies: classes.Movie ?? 0 };
}

export function voidMeta() {
  const rows = select(`SELECT ?p ?o WHERE { GRAPH ${VOID_G} { ${DS} ?p ?o } }`);
  const one = (local: string) => rows.find((r) => r.p!.value.endsWith(local))?.o?.value;
  return {
    title: one("/title"),
    description: one("/description"),
    license: one("/license"),
    modified: one("/modified"),
    version: one("#versionInfo"),
    sparql: one("#sparqlEndpoint"),
    sources: rows.filter((r) => r.p!.value.endsWith("/source")).map((r) => r.o!.value),
  };
}
