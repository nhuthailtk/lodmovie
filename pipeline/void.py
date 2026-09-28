"""VoID / DCAT description of the dataset, with statistics computed from the built graphs."""

from __future__ import annotations

from datetime import datetime

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import DCAT, DCTERMS, FOAF, OWL, RDF, SKOS, VOID, XSD

from .config import (
    DATA_DUMP,
    DATASET_TITLE,
    DATASET_URI,
    DATASET_VERSION,
    DBO,
    DBR,
    LICENSE,
    MO,
    RESOURCE,
    SCHEMA,
    SPARQL_ENDPOINT,
    WD,
    bind_namespaces,
)
from .load import Crawl
from .translate import TitleRow

VOID_CLASS = URIRef(str(VOID) + "class")
PARTITIONS = (
    ("movie", MO.Movie),
    ("person", MO.Person),
    ("credit", MO.Credit),
    ("genre", MO.Genre),
    ("profession", MO.Profession),
)
LINK_TARGETS = (
    ("wikidata", "http://www.wikidata.org/", str(WD)),
    ("dbpedia", "http://dbpedia.org/", str(DBR)),
)


def build_void(*, data: Graph, links: Graph, crawl: Crawl, titles: dict[str, TitleRow], modified: datetime) -> Graph:
    graph = bind_namespaces(Graph())
    dataset = URIRef(DATASET_URI)
    graph.add((dataset, RDF.type, VOID.Dataset))
    graph.add((dataset, RDF.type, DCAT.Dataset))
    graph.add((dataset, DCTERMS.title, Literal(DATASET_TITLE, lang="en")))
    graph.add((dataset, DCTERMS.description, Literal(_description(crawl, titles), lang="en")))
    graph.add((dataset, DCTERMS.license, URIRef(LICENSE)))
    graph.add((dataset, DCTERMS.modified, Literal(modified.isoformat(), datatype=XSD.dateTime)))
    graph.add((dataset, OWL.versionInfo, Literal(DATASET_VERSION)))
    for source in crawl.sources:
        graph.add((dataset, DCTERMS.source, URIRef(source["url"])))
    graph.add((dataset, VOID.uriSpace, Literal(RESOURCE)))
    graph.add((dataset, VOID.sparqlEndpoint, URIRef(SPARQL_ENDPOINT)))
    graph.add((dataset, VOID.dataDump, URIRef(DATA_DUMP)))
    for vocabulary in (MO, SCHEMA, DBO, SKOS, FOAF):
        graph.add((dataset, VOID.vocabulary, URIRef(str(vocabulary))))
    movies = sorted(data.subjects(RDF.type, MO.Movie))
    if movies:
        graph.add((dataset, VOID.exampleResource, movies[0]))

    graph.add((dataset, VOID.triples, Literal(len(data) + len(links))))
    graph.add((dataset, VOID.entities, Literal(len(set(data.subjects(RDF.type, None))))))
    for key, cls in PARTITIONS:
        partition = URIRef(f"{DATASET_URI}/partition/{key}")
        graph.add((dataset, VOID.classPartition, partition))
        graph.add((partition, VOID_CLASS, cls))
        graph.add((partition, VOID.entities, Literal(len(set(data.subjects(RDF.type, cls))))))

    for key, target, prefix in LINK_TARGETS:
        triples = [(s, p, o) for s, p, o in links if str(o).startswith(prefix)]
        linkset = URIRef(f"{DATASET_URI}/linkset/{key}")
        target_uri = URIRef(target)
        graph.add((dataset, VOID.subset, linkset))
        graph.add((linkset, RDF.type, VOID.Linkset))
        graph.add((linkset, VOID.subjectsTarget, dataset))
        graph.add((linkset, VOID.objectsTarget, target_uri))
        graph.add((target_uri, RDF.type, VOID.Dataset))
        graph.add((linkset, VOID.triples, Literal(len(triples))))
        for predicate in sorted({p for _, p, _ in triples}):
            graph.add((linkset, VOID.linkPredicate, predicate))
    return graph


def _description(crawl: Crawl, titles: dict[str, TitleRow]) -> str:
    used = [titles[i] for i in crawl.movies if i in titles]
    machine = sum(1 for t in used if t.source == "machine")
    reviewed = sum(1 for t in used if t.source == "reviewed")
    return (
        f"Linked Open Data about {len(crawl.movies)} movies and {len(crawl.people)} people from the IMDb "
        f"non-commercial datasets, linked to Wikidata and DBpedia. English and Vietnamese titles were "
        f"translated with Claude Code ({machine} machine-translated, {reviewed} reviewed by a person)."
    )
