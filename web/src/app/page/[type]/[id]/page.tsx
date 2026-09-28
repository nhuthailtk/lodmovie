import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConceptDetail, CreditDetail, GenericDetail, MovieDetail, PersonDetail } from "@/components/views";
import { exists } from "@/lib/linked-data";
import { resourceIri } from "@/lib/rdf";
import { conceptView, creditView, genericView, labelOf, movieIds, movieView, personView } from "@/lib/resource";

type Props = { params: Promise<{ type: string; id: string }> };

/** The 300 movie pages are built ahead of time; everything else renders on first visit and is then cached. */
export function generateStaticParams() {
  return movieIds().map((id) => ({ type: "movie", id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) return {};
  return {
    title: labelOf(iri) ?? id,
    alternates: {
      types: {
        "text/turtle": `/data/${type}/${id}.ttl`,
        "application/ld+json": `/data/${type}/${id}.jsonld`,
      },
    },
  };
}

export default async function ResourcePage({ params }: Props) {
  const { type, id } = await params;
  const iri = resourceIri(type, id);
  if (!iri || !exists(iri)) notFound();
  const common = { iri, type, id };
  if (type === "movie") {
    const m = movieView(iri);
    if (m) return <MovieDetail {...common} m={m} />;
  }
  if (type === "person") {
    const p = personView(iri);
    if (p) return <PersonDetail {...common} p={p} />;
  }
  if (type === "genre" || type === "profession") {
    const c = conceptView(iri, type);
    if (c) return <ConceptDetail {...common} c={c} />;
  }
  if (type === "credit") {
    const c = creditView(iri);
    if (c) return <CreditDetail {...common} c={c} />;
  }
  return <GenericDetail {...common} t={genericView(iri)} title={labelOf(iri) ?? id} />;
}
