export const BASE = "https://lod-movie.felix-nguyen.io.vn/";
export const RESOURCE = `${BASE}resource/`;
export const ONTOLOGY = `${BASE}ontology`;
export const MO = `${ONTOLOGY}#`;
export const DATASET = `${BASE}dataset`;

export const GRAPH = {
  data: `${BASE}graph/data`,
  links: `${BASE}graph/links`,
  ontology: `${BASE}graph/ontology`,
  void: `${BASE}graph/void`,
} as const;

export const PREFIXES: Record<string, string> = {
  mo: MO,
  movie: `${RESOURCE}movie/`,
  person: `${RESOURCE}person/`,
  genre: `${RESOURCE}genre/`,
  profession: `${RESOURCE}profession/`,
  credit: `${RESOURCE}credit/`,
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  schema: "https://schema.org/",
  foaf: "http://xmlns.com/foaf/0.1/",
  dcterms: "http://purl.org/dc/terms/",
  dcat: "http://www.w3.org/ns/dcat#",
  void: "http://rdfs.org/ns/void#",
  dbo: "http://dbpedia.org/ontology/",
  dbr: "http://dbpedia.org/resource/",
  wd: "http://www.wikidata.org/entity/",
};

export const RESOURCE_TYPES = ["movie", "person", "genre", "profession", "credit", "scheme"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESULT_LIMIT = 10_000;
export const MAX_RESPONSE_BYTES = 4_000_000;
export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
export const USER_AGENT = "lod-movie-capstone/1.0 (https://lod-movie.felix-nguyen.io.vn/; semantic-web student project)";
