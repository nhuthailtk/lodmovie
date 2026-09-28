import { USER_AGENT, WIKIDATA_ENDPOINT } from "./config";

export type WikidataFacts = {
  qid: string;
  label?: string;
  description?: string;
  image?: string;
  wikipedia?: string;
  facts: { label: string; value: string }[];
};

type Binding = Record<string, { value: string } | undefined>;

const common = (qid: string) => `
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }`;

const QUERIES = {
  movie: (qid: string) => `SELECT (SAMPLE(?label) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?article) AS ?wikipedia)
  (SAMPLE(?img) AS ?image) (GROUP_CONCAT(DISTINCT ?countryLabel; separator=", ") AS ?countries)
  (MIN(?date) AS ?released) (COUNT(DISTINCT ?award) AS ?awards) WHERE {${common(qid)}
  OPTIONAL { ?item wdt:P3383|wdt:P18 ?img }
  OPTIONAL { ?item wdt:P495 ?country . ?country rdfs:label ?countryLabel FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?item wdt:P577 ?date }
  OPTIONAL { ?item wdt:P166 ?award }
}`,
  person: (qid: string) => `SELECT (SAMPLE(?label) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?article) AS ?wikipedia)
  (SAMPLE(?img) AS ?image) (MIN(?birth) AS ?born) (SAMPLE(?placeLabel) AS ?birthplace)
  (GROUP_CONCAT(DISTINCT ?citizenLabel; separator=", ") AS ?citizenship) WHERE {${common(qid)}
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P19 ?place . ?place rdfs:label ?placeLabel FILTER(LANG(?placeLabel) = "en") }
  OPTIONAL { ?item wdt:P27 ?citizen . ?citizen rdfs:label ?citizenLabel FILTER(LANG(?citizenLabel) = "en") }
}`,
};

export type WikidataKind = keyof typeof QUERIES;

const day = (value?: string) => value?.slice(0, 10);

/** A few facts about a Wikidata item, fetched live and cached for a day. */
export async function wikidataFacts(qid: string, kind: WikidataKind): Promise<WikidataFacts> {
  const response = await fetch(`${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(QUERIES[kind](qid))}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const row: Binding = (await response.json()).results.bindings[0] ?? {};
  const facts: WikidataFacts["facts"] = [];
  const add = (label: string, value?: string) => {
    if (value) facts.push({ label, value });
  };
  if (kind === "movie") {
    add("Country of origin", row.countries?.value);
    add("First release", day(row.released?.value));
    const awards = Number(row.awards?.value ?? 0);
    if (awards) add("Awards received", String(awards));
  } else {
    add("Born", day(row.born?.value));
    add("Place of birth", row.birthplace?.value);
    add("Citizenship", row.citizenship?.value);
  }
  const image = row.image?.value;
  return {
    qid,
    label: row.label?.value,
    description: row.description?.value,
    wikipedia: row.wikipedia?.value,
    image: image ? `${image.replace(/^http:/, "https:")}?width=360` : undefined,
    facts,
  };
}
