import Link from "next/link";
import { pageHref, shorten, type Term } from "@/lib/rdf";

/** Render an RDF term: internal IRIs link to their page, external ones open in a new tab. */
export function TermValue({ term }: { term: Term }) {
  if (term.type === "uri") return <IriLink iri={term.value} />;
  if (term.type === "bnode") return <span className="text-slate-500">_:{term.value}</span>;
  const note = term.lang ? `@${term.lang}` : term.datatype && !term.datatype.endsWith("#string") ? shorten(term.datatype) : "";
  return (
    <span className="break-words">
      {term.value}
      {note && <sup className="ml-1 text-xs text-slate-500">{note}</sup>}
    </span>
  );
}

export function IriLink({ iri, label }: { iri: string; label?: string }) {
  const href = pageHref(iri);
  const text = label ?? shorten(iri);
  return href ? (
    <Link className="link break-all" href={href}>{text}</Link>
  ) : (
    <a className="link break-all" href={iri} target="_blank" rel="noreferrer">{text}</a>
  );
}
