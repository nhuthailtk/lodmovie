import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PROJECT } from "@/lib/project";
import hust from "../../public/hust.jpg";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://lod-movie.felix-nguyen.io.vn"),
  title: { default: "LOD Movie", template: "%s · LOD Movie" },
  description: `Linked Open Data about 300 IMDb movies, linked to Wikidata and DBpedia, with a public SPARQL endpoint. ${PROJECT.course} · ${PROJECT.group} · ${PROJECT.university}.`,
};

const NAV = [
  ["/movies", "Movies"],
  ["/people", "People"],
  ["/sparql", "SPARQL"],
  ["/explore", "Explore"],
  ["/ontology", "Ontology"],
  ["/dataset", "Dataset"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <header className="border-b border-slate-200 dark:border-slate-800">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-3">
              <span className="rounded-md bg-white p-1 ring-1 ring-slate-200 dark:ring-slate-700">
                <Image src={hust} alt={PROJECT.university} height={32} priority className="h-8 w-auto" />
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-semibold tracking-tight">
                  LOD<span className="text-indigo-600 dark:text-indigo-400">Movie</span>
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {PROJECT.course} · {PROJECT.group}
                </span>
              </span>
            </Link>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400">
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 text-sm text-slate-500 dark:border-slate-800">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6">
            <p>
              Data from the{" "}
              <a className="link" href="https://developer.imdb.com/non-commercial-datasets/">IMDb non-commercial datasets</a>, linked to
              Wikidata and DBpedia. {PROJECT.course} capstone project · {PROJECT.group} · {PROJECT.university}.
            </p>
            <p className="flex gap-4">
              <Link className="link" href="/dataset">About the dataset</Link>
              <Link className="link" href="/sparql">SPARQL endpoint</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
