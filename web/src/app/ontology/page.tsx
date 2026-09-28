import CopyButton from "@/components/copy-button";
import OntologyGraph from "@/components/ontology-graph";
import { IriLink } from "@/components/term";
import { PageHeader, Section } from "@/components/ui";
import { ONTOLOGY } from "@/lib/config";
import { ontologyDiagram, ontologyHeader, ontologyTerms, RELATION_LABELS, type OntologyTerm, type TermKind } from "@/lib/ontology";

export const metadata = { title: "Ontology" };
// Same URL serves RDF to machines (proxy.ts); rendering per request lets the Vary: Accept header reach the HTML variant.
export const dynamic = "force-dynamic";

const GROUPS: [TermKind, string][] = [
  ["Class", "Classes"],
  ["ObjectProperty", "Object properties"],
  ["DatatypeProperty", "Datatype properties"],
];

function TermDoc({ term }: { term: OntologyTerm }) {
  return (
    <article id={term.name} className="card scroll-mt-20 space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="font-mono text-lg font-semibold">mo:{term.name}</h3>
        <span className="text-sm text-slate-500">{term.label}</span>
        {term.functional && <span className="rounded bg-amber-100 px-2 text-xs text-amber-800">functional</span>}
      </div>
      {term.comment && <p className="text-slate-600 dark:text-slate-300">{term.comment}</p>}
      {Object.keys(term.relations).length > 0 && (
        <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
          {Object.entries(term.relations).map(([rel, targets]) => (
            <div key={rel} className="contents">
              <dt className="text-slate-500">{RELATION_LABELS[rel] ?? rel}</dt>
              <dd className="flex flex-wrap gap-x-3">{targets.map((t) => <IriLink key={t} iri={t} />)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

export default function OntologyPage() {
  const header = ontologyHeader();
  const terms = ontologyTerms();
  const diagram = ontologyDiagram(terms);
  return (
    <div className="space-y-12">
      <PageHeader eyebrow={`Ontology · version ${header.version ?? "1.0.0"}`} title={header.title ?? "LOD Movie Ontology"}>
        <p>{header.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">{ONTOLOGY}#</code>
          <CopyButton text={`${ONTOLOGY}#`} />
          <a className="btn" href="/downloads/ontology.ttl">Download Turtle</a>
        </div>
        <p className="text-sm">
          This URI dereferences: browsers get this page, RDF clients get the ontology (try <code>curl -H &quot;Accept: text/turtle&quot; {ONTOLOGY}</code>).
          Term URIs such as <code>{ONTOLOGY}#Movie</code> land on their section below.
        </p>
      </PageHeader>
      <Section title="Diagram">
        <OntologyGraph nodes={diagram.nodes} edges={diagram.edges} />
      </Section>
      {GROUPS.map(([kind, title]) => (
        <Section key={kind} title={title}>
          <div className="grid gap-4 lg:grid-cols-2">
            {terms.filter((t) => t.kind === kind).map((t) => <TermDoc key={t.iri} term={t} />)}
          </div>
        </Section>
      ))}
    </div>
  );
}
