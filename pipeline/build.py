"""Build the LOD Movie dataset: load -> transform -> link -> describe -> validate -> write dist/."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from rdflib import Graph

from .config import (
    BAD_ROW_THRESHOLD,
    DEFAULT_INPUT,
    DIST_DIR,
    LINKS_DIR,
    MAPPINGS_DIR,
    ONTOLOGY_PATH,
    SHAPES_PATH,
    TITLES_PATH,
    bind_namespaces,
    utf8_stdout,
)
from .link import (
    WikidataClient,
    build_link_graph,
    load_link_store,
    load_mappings,
    resolve_links,
    save_link_store,
)
from .load import load_crawl
from .transform import build_data_graph
from .translate import load_titles
from .validate import validate
from .void import build_void


def run_build(
    *,
    inputs: list[Path],
    out: Path = DIST_DIR,
    links_dir: Path = LINKS_DIR,
    mappings_dir: Path = MAPPINGS_DIR,
    titles_path: Path = TITLES_PATH,
    ontology_path: Path = ONTOLOGY_PATH,
    shapes_path: Path = SHAPES_PATH,
    refresh: bool = False,
    offline: bool = False,
    client=None,
    now: datetime | None = None,
) -> int:
    started = time.perf_counter()
    now = now or datetime.now(timezone.utc).replace(microsecond=0)

    crawl = load_crawl(inputs)
    if crawl.bad_row_ratio > BAD_ROW_THRESHOLD:
        print(f"Too many malformed rows: {crawl.rows_bad}/{crawl.rows_read} (limit {BAD_ROW_THRESHOLD:.0%})")
        for warning in crawl.warnings[:20]:
            print(f"  {warning}")
        return 2

    titles = load_titles(titles_path)
    data, transform_warnings = build_data_graph(crawl, titles)

    movie_store = load_link_store(links_dir / "movies.csv")
    person_store = load_link_store(links_dir / "people.csv")
    if not offline and client is None:
        client = WikidataClient(cache_dir=links_dir / "cache")
    active_client = None if offline else client
    try:
        link_warnings = resolve_links(crawl.movies.keys(), movie_store, active_client, refresh=refresh)
        link_warnings += resolve_links(crawl.people.keys(), person_store, active_client, refresh=refresh)
    finally:
        # Keep every batch already fetched, even on Ctrl-C or an unexpected error.
        if not offline:
            save_link_store(links_dir / "movies.csv", movie_store)
            save_link_store(links_dir / "people.csv", person_store)

    links, link_report = build_link_graph(
        crawl,
        movie_store,
        person_store,
        load_mappings(mappings_dir / "genres.csv"),
        load_mappings(mappings_dir / "professions.csv"),
    )
    for kind in ("genres", "professions"):
        if link_report[kind]["unmapped"]:
            link_warnings.append(f"unmapped {kind}: {', '.join(link_report[kind]['unmapped'])}")

    ontology = Graph().parse(ontology_path)
    void = build_void(data=data, links=links, crawl=crawl, titles=titles, modified=now)
    result = validate(ontology, data, links, shapes_path)
    if not result.conforms:
        print(f"Validation failed with {len(result.violations)} violation(s); {out} left unchanged.")
        for violation in result.violations[:20]:
            print(f"  {violation}")
        return 1

    warnings = crawl.warnings + transform_warnings + link_warnings + result.warnings
    build_report = {
        "built_at": now.isoformat(),
        "inputs": [str(p) for p in inputs],
        "counts": {
            "movies": len(crawl.movies),
            "people": len(crawl.people),
            "credits": len(crawl.credits),
            "genres": len(crawl.genres),
            "professions": len(crawl.professions),
        },
        "triples": {"ontology": len(ontology), "data": len(data), "links": len(links), "void": len(void)},
        "rows_read": crawl.rows_read,
        "rows_bad": crawl.rows_bad,
        "warnings": warnings,
    }
    _write_outputs(out, ontology_path, ontology, data, links, void, link_report, build_report)
    _print_summary(out, build_report, link_report, time.perf_counter() - started)
    return 0


def _write_outputs(out: Path, ontology_path: Path, ontology: Graph, data: Graph, links: Graph,
                   void: Graph, link_report: dict, build_report: dict) -> None:
    tmp = out.with_name(out.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    shutil.copyfile(ontology_path, tmp / "ontology.ttl")
    _write_ntriples(data, tmp / "data.nt")
    _write_ntriples(links, tmp / "links.nt")
    (tmp / "void.ttl").write_text(void.serialize(format="turtle"), encoding="utf-8", newline="\n")

    combined = bind_namespaces(Graph())
    for graph in (ontology, data, links, void):
        combined += graph
    with gzip.GzipFile(tmp / "all.ttl.gz", "wb", mtime=0) as f:
        f.write(combined.serialize(format="turtle").encode("utf-8"))

    for name, report in (("link_report.json", link_report), ("build_report.json", build_report)):
        (tmp / name).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    # Rename before deleting: a locked file in the old output can never leave dist/ half-deleted.
    old = out.with_name(out.name + ".old")
    _remove_quietly(old)
    if out.exists():
        out.rename(old)
    tmp.rename(out)
    _remove_quietly(old)


def _remove_quietly(path: Path) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path)
    except OSError as exc:
        print(f"  note: could not remove {path} ({exc}); delete it by hand")


def _write_ntriples(graph: Graph, path: Path) -> None:
    lines = sorted(line for line in graph.serialize(format="nt").splitlines() if line.strip())
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _print_summary(out: Path, report: dict, links: dict, seconds: float) -> None:
    counts, triples = report["counts"], report["triples"]
    print(f"Built {out} in {seconds:.1f}s")
    print(f"  movies {counts['movies']} | people {counts['people']} | credits {counts['credits']}")
    print(f"  triples: data {triples['data']} | links {triples['links']} | ontology {triples['ontology']} | void {triples['void']}")
    for kind in ("movies", "people"):
        r = links[kind]
        print(f"  {kind}: {r['wikidata']}/{r['total']} linked to Wikidata ({r['wikidata_pct']}%), {r['dbpedia']} to DBpedia")
    for kind in ("genres", "professions"):
        print(f"  {kind}: {links[kind]['mapped']}/{links[kind]['total']} mapped")
    print(f"  warnings: {len(report['warnings'])} (see {out / 'build_report.json'})")


def main(argv: list[str] | None = None) -> int:
    utf8_stdout()
    parser = argparse.ArgumentParser(prog="python -m pipeline.build", description=__doc__)
    parser.add_argument("--input", action="append", type=Path, help="crawl folder (repeatable; default: data/)")
    parser.add_argument("--out", type=Path, default=DIST_DIR, help="output folder (default: dist/)")
    parser.add_argument("--refresh", action="store_true", help="re-check every IMDb ID against Wikidata")
    parser.add_argument("--offline", action="store_true", help="do not contact Wikidata; use the committed link store")
    args = parser.parse_args(argv)
    return run_build(inputs=args.input or [DEFAULT_INPUT], out=args.out, refresh=args.refresh, offline=args.offline)


if __name__ == "__main__":
    raise SystemExit(main())
