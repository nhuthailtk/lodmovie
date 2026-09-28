export type Example = { title: string; description: string; query: string };

const LINKS = "<https://lod-movie.felix-nguyen.io.vn/graph/links>";
const DATA = "<https://lod-movie.felix-nguyen.io.vn/graph/data>";
const DS = "<https://lod-movie.felix-nguyen.io.vn/dataset>";

/** Example queries shown in the SPARQL editor, on the home page and on the dataset page. */
export const EXAMPLES: Example[] = [
  {
    title: "Top-rated movies (English + Vietnamese titles)",
    description: "Language-tagged rdfs:label values in both languages.",
    query: `SELECT ?movie ?english ?vietnamese ?year ?rating WHERE {
  ?movie a mo:Movie ; mo:releaseYear ?year ; mo:averageRating ?rating ;
         rdfs:label ?english , ?vietnamese .
  FILTER(LANG(?english) = "en" && LANG(?vietnamese) = "vi")
}
ORDER BY DESC(?rating)
LIMIT 20`,
  },
  {
    title: "Sci-Fi movies by year",
    description: "Genres are SKOS concepts linked with mo:hasGenre.",
    query: `SELECT ?movie ?title ?year WHERE {
  ?movie mo:hasGenre genre:sci-fi ; mo:releaseYear ?year ; rdfs:label ?title .
  FILTER(LANG(?title) = "en")
}
ORDER BY ?year`,
  },
  {
    title: "Directors with more than one movie",
    description: "Aggregation over mo:directedBy.",
    query: `SELECT ?director ?name (COUNT(?movie) AS ?movies) (GROUP_CONCAT(?title; separator=" | ") AS ?titles) WHERE {
  ?movie mo:directedBy ?director ; rdfs:label ?title .
  ?director rdfs:label ?name .
  FILTER(LANG(?title) = "en")
}
GROUP BY ?director ?name
HAVING (COUNT(?movie) > 1)
ORDER BY DESC(?movies)`,
  },
  {
    title: "Cast of Jurassic Park with characters",
    description: "The n-ary mo:Credit pattern: movie → credit → person + role + character.",
    query: `SELECT ?order ?actor ?name ?character WHERE {
  movie:tt0107290 mo:hasCredit ?credit .
  ?credit mo:billingOrder ?order ; mo:creditedPerson ?actor ; mo:characterName ?character .
  ?actor rdfs:label ?name .
}
ORDER BY ?order`,
  },
  {
    title: "Most prolific actors",
    description: "Who appears in the most movies of the dataset.",
    query: `SELECT ?person ?name (COUNT(DISTINCT ?movie) AS ?movies) WHERE {
  ?movie mo:hasActor ?person .
  ?person rdfs:label ?name .
}
GROUP BY ?person ?name
ORDER BY DESC(?movies)
LIMIT 20`,
  },
  {
    title: "Movies linked to Wikidata and DBpedia (5★)",
    description: "Only the links named graph: owl:sameAs to other datasets.",
    query: `SELECT ?movie ?title ?wikidata ?dbpedia WHERE {
  ?movie a mo:Movie ; rdfs:label ?title .
  FILTER(LANG(?title) = "en")
  GRAPH ${LINKS} {
    ?movie owl:sameAs ?wikidata .
    FILTER(STRSTARTS(STR(?wikidata), STR(wd:)))
    OPTIONAL { ?movie owl:sameAs ?dbpedia . FILTER(STRSTARTS(STR(?dbpedia), STR(dbr:))) }
  }
}
LIMIT 50`,
  },
  {
    title: "Genres and their Wikidata/DBpedia matches",
    description: "SKOS mapping links (skos:exactMatch / skos:closeMatch).",
    query: `SELECT ?genre ?label ?relation ?match WHERE {
  ?genre a mo:Genre ; skos:prefLabel ?label .
  OPTIONAL { ?genre ?relation ?match . FILTER(?relation IN (skos:exactMatch, skos:closeMatch)) }
}
ORDER BY ?label`,
  },
  {
    title: "Property usage in the data",
    description: "How often each property is used in the instance data graph.",
    query: `SELECT ?property (COUNT(*) AS ?uses) WHERE {
  GRAPH ${DATA} { ?s ?property ?o }
}
GROUP BY ?property
ORDER BY DESC(?uses)`,
  },
  {
    title: "VoID class partitions",
    description: "Dataset statistics from the VoID description.",
    query: `SELECT ?class ?entities WHERE {
  ${DS} void:classPartition ?partition .
  ?partition void:class ?class ; void:entities ?entities .
}
ORDER BY DESC(?entities)`,
  },
  {
    title: "VoID linksets",
    description: "How many links go to each external dataset, and with which predicates.",
    query: `SELECT ?linkset ?target ?predicate ?triples WHERE {
  ${DS} void:subset ?linkset .
  ?linkset void:objectsTarget ?target ; void:linkPredicate ?predicate ; void:triples ?triples .
}`,
  },
  {
    title: "People born in the 1970s and their professions",
    description: "Numeric filters on xsd:integer years plus a property path.",
    query: `SELECT ?person ?name ?born (GROUP_CONCAT(DISTINCT ?profession; separator=", ") AS ?professions) WHERE {
  ?person a mo:Person ; rdfs:label ?name ; mo:birthYear ?born .
  FILTER(?born >= 1970 && ?born < 1980)
  OPTIONAL { ?person mo:primaryProfession/skos:prefLabel ?profession }
}
GROUP BY ?person ?name ?born
ORDER BY ?born
LIMIT 50`,
  },
];
