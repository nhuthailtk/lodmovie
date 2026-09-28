import { toCard, type MovieCard, type Named } from "./queries";
import { asNumber, asString, iriRef, localName, type Term } from "./rdf";
import { select } from "./store";

export type CreditRow = { iri: string; order: number; person: Named; role: string; job?: string; characters?: string };
export type MovieView = {
  iri: string;
  imdbId: string;
  primaryTitle: string;
  originalTitle?: string;
  en?: string;
  vi?: string;
  year?: number;
  runtime?: number;
  rating?: number;
  votes?: number;
  genres: Named[];
  directors: Named[];
  writers: Named[];
  cast: CreditRow[];
  crew: CreditRow[];
  sameAs: string[];
};
export type FilmRow = { movie: Named; year?: number; roles: string[] };
export type PersonView = {
  iri: string;
  imdbId: string;
  name: string;
  birthYear?: number;
  deathYear?: number;
  professions: Named[];
  films: FilmRow[];
  knownFor: Named[];
  sameAs: string[];
};
export type ConceptView = {
  iri: string;
  kind: "genre" | "profession";
  label: string;
  isTarget?: boolean;
  matches: { iri: string; exact: boolean }[];
  movies: MovieCard[];
  people: Named[];
  peopleTotal: number;
};
export type CreditView = { iri: string; movie: Named; person: Named; role: string; order: number; job?: string; characters: string[] };
export type TripleView = { outgoing: { p: Term; o: Term }[]; incoming: { s: Term; p: Term }[] };

const CAST_ROLES = new Set(["actor", "actress", "self", "archive footage"]);

function named(query: string): Named[] {
  return select(query).map((r) => ({ iri: r.iri!.value, label: r.label!.value }));
}

export function labelOf(iri: string): string | undefined {
  const rows = select(`SELECT ?label WHERE { ${iriRef(iri)} rdfs:label|skos:prefLabel ?label } ORDER BY DESC(LANG(?label) = "en")`);
  return rows[0]?.label?.value;
}

export function sameAs(iri: string): string[] {
  return select(`SELECT ?x WHERE { ${iriRef(iri)} owl:sameAs ?x } ORDER BY ?x`).map((r) => r.x!.value);
}

export function wikidataQid(links: string[]): string | undefined {
  const wd = links.find((l) => l.startsWith("http://www.wikidata.org/entity/Q"));
  return wd ? localName(wd) : undefined;
}

export function movieIds(): string[] {
  return select(`SELECT ?m WHERE { ?m a mo:Movie }`).map((r) => localName(r.m!.value));
}

export function movieView(iri: string): MovieView | null {
  const r = iriRef(iri);
  const core = select(`SELECT * WHERE {
    ${r} a mo:Movie ; mo:imdbId ?imdb ; mo:primaryTitle ?pt .
    OPTIONAL { ${r} mo:originalTitle ?ot }
    OPTIONAL { ${r} rdfs:label ?en FILTER(LANG(?en) = "en") }
    OPTIONAL { ${r} rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
    OPTIONAL { ${r} mo:releaseYear ?year }
    OPTIONAL { ${r} mo:runtimeMinutes ?runtime }
    OPTIONAL { ${r} mo:averageRating ?rating }
    OPTIONAL { ${r} mo:numVotes ?votes }
  }`)[0];
  if (!core) return null;
  const credits: CreditRow[] = select(`SELECT ?c ?order ?p ?name ?role ?job (GROUP_CONCAT(?ch; separator=" / ") AS ?chars) WHERE {
    ${r} mo:hasCredit ?c .
    ?c mo:billingOrder ?order ; mo:creditedPerson ?p ; mo:creditRole/skos:prefLabel ?role .
    ?p rdfs:label ?name .
    OPTIONAL { ?c mo:job ?job }
    OPTIONAL { ?c mo:characterName ?ch }
  } GROUP BY ?c ?order ?p ?name ?role ?job ORDER BY ?order`).map((row) => ({
    iri: row.c!.value,
    order: Number(row.order!.value),
    person: { iri: row.p!.value, label: row.name!.value },
    role: row.role!.value,
    job: asString(row.job),
    characters: asString(row.chars),
  }));
  return {
    iri,
    imdbId: core.imdb!.value,
    primaryTitle: core.pt!.value,
    originalTitle: asString(core.ot),
    en: asString(core.en),
    vi: asString(core.vi),
    year: asNumber(core.year),
    runtime: asNumber(core.runtime),
    rating: asNumber(core.rating),
    votes: asNumber(core.votes),
    genres: named(`SELECT ?iri ?label WHERE { ${r} mo:hasGenre ?iri . ?iri skos:prefLabel ?label } ORDER BY ?label`),
    directors: named(`SELECT ?iri ?label WHERE { ${r} mo:directedBy ?iri . ?iri rdfs:label ?label } ORDER BY ?label`),
    writers: named(`SELECT ?iri ?label WHERE { ${r} mo:writtenBy ?iri . ?iri rdfs:label ?label } ORDER BY ?label`),
    cast: credits.filter((c) => CAST_ROLES.has(c.role)),
    crew: credits.filter((c) => !CAST_ROLES.has(c.role)),
    sameAs: sameAs(iri),
  };
}

export function personView(iri: string): PersonView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?name ?imdb ?birth ?death WHERE {
    ${r} a mo:Person ; rdfs:label ?name ; mo:imdbId ?imdb .
    OPTIONAL { ${r} mo:birthYear ?birth }
    OPTIONAL { ${r} mo:deathYear ?death }
  }`)[0];
  if (!core) return null;
  const films = new Map<string, FilmRow>();
  for (const row of select(`SELECT DISTINCT ?iri ?label ?year ?role WHERE {
      { ?iri mo:hasCredit ?c . ?c mo:creditedPerson ${r} ; mo:creditRole/skos:prefLabel ?role }
      UNION { VALUES (?prop ?role) { (mo:directedBy "director") (mo:writtenBy "writer") (mo:hasActor "actor") } ?iri ?prop ${r} }
      ?iri mo:primaryTitle ?pt .
      OPTIONAL { ?iri mo:releaseYear ?year }
      OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
      BIND(COALESCE(?en, ?pt) AS ?label)
    } ORDER BY DESC(?year) ?label`)) {
    const key = row.iri!.value;
    const film = films.get(key) ?? { movie: { iri: key, label: row.label!.value }, year: asNumber(row.year), roles: [] };
    if (!film.roles.includes(row.role!.value)) film.roles.push(row.role!.value);
    films.set(key, film);
  }
  return {
    iri,
    imdbId: core.imdb!.value,
    name: core.name!.value,
    birthYear: asNumber(core.birth),
    deathYear: asNumber(core.death),
    professions: named(`SELECT ?iri ?label WHERE { ${r} mo:primaryProfession ?iri . ?iri skos:prefLabel ?label }`),
    films: [...films.values()],
    knownFor: named(`SELECT ?iri ?label WHERE { ${r} mo:knownFor ?iri . ?iri mo:primaryTitle ?pt . OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") } BIND(COALESCE(?en, ?pt) AS ?label) }`),
    sameAs: sameAs(iri),
  };
}

export function conceptView(iri: string, kind: "genre" | "profession"): ConceptView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?label ?target WHERE { ${r} skos:prefLabel ?label . OPTIONAL { ${r} mo:isTargetGenre ?target } }`)[0];
  if (!core) return null;
  const matches = select(`SELECT ?m ?rel WHERE { ${r} ?rel ?m FILTER(?rel IN (skos:exactMatch, skos:closeMatch)) } ORDER BY ?m`).map((x) => ({
    iri: x.m!.value,
    exact: x.rel!.value.endsWith("exactMatch"),
  }));
  const movies =
    kind === "genre"
      ? select(`SELECT ?iri ?title ?vi ?year ?rating WHERE {
          ?iri mo:hasGenre ${r} ; mo:primaryTitle ?pt .
          OPTIONAL { ?iri rdfs:label ?en FILTER(LANG(?en) = "en") }
          OPTIONAL { ?iri rdfs:label ?vi FILTER(LANG(?vi) = "vi") }
          OPTIONAL { ?iri mo:releaseYear ?year }
          OPTIONAL { ?iri mo:averageRating ?rating }
          BIND(COALESCE(?en, ?pt) AS ?title)
        } ORDER BY DESC(?rating)`).map(toCard)
      : [];
  const people = kind === "profession" ? named(`SELECT ?iri ?label WHERE { ?iri mo:primaryProfession ${r} ; rdfs:label ?label } ORDER BY ?label LIMIT 300`) : [];
  const peopleTotal = kind === "profession" ? Number(select(`SELECT (COUNT(?p) AS ?n) WHERE { ?p mo:primaryProfession ${r} }`)[0]?.n?.value ?? 0) : 0;
  return { iri, kind, label: core.label!.value, isTarget: core.target ? core.target.value === "true" : undefined, matches, movies, people, peopleTotal };
}

export function creditView(iri: string): CreditView | null {
  const r = iriRef(iri);
  const core = select(`SELECT ?movie ?title ?person ?name ?role ?order ?job WHERE {
    ?movie mo:hasCredit ${r} ; mo:primaryTitle ?pt .
    OPTIONAL { ?movie rdfs:label ?en FILTER(LANG(?en) = "en") }
    BIND(COALESCE(?en, ?pt) AS ?title)
    ${r} mo:creditedPerson ?person ; mo:creditRole/skos:prefLabel ?role ; mo:billingOrder ?order .
    ?person rdfs:label ?name .
    OPTIONAL { ${r} mo:job ?job }
  }`)[0];
  if (!core) return null;
  return {
    iri,
    movie: { iri: core.movie!.value, label: core.title!.value },
    person: { iri: core.person!.value, label: core.name!.value },
    role: core.role!.value,
    order: Number(core.order!.value),
    job: asString(core.job),
    characters: select(`SELECT ?c WHERE { ${r} mo:characterName ?c }`).map((x) => x.c!.value),
  };
}

export function genericView(iri: string): TripleView {
  const r = iriRef(iri);
  return {
    outgoing: select(`SELECT ?p ?o WHERE { ${r} ?p ?o } ORDER BY ?p LIMIT 300`).map((x) => ({ p: x.p!, o: x.o! })),
    incoming: select(`SELECT ?s ?p WHERE { ?s ?p ${r} } ORDER BY ?p LIMIT 300`).map((x) => ({ s: x.s!, p: x.p! })),
  };
}
