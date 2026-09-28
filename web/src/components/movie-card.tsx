import Link from "next/link";
import type { MovieCard as Movie } from "@/lib/queries";
import { pageHref } from "@/lib/rdf";

export default function MovieCard({ movie }: { movie: Movie }) {
  const meta = [movie.year, movie.rating !== undefined ? `★ ${movie.rating.toFixed(1)}` : null].filter(Boolean).join(" · ");
  return (
    <Link href={pageHref(movie.iri) ?? "#"} className="card block space-y-1 hover:border-indigo-400">
      <div className="font-semibold leading-snug">{movie.title}</div>
      {movie.vi && <div className="text-sm text-slate-600 dark:text-slate-300">{movie.vi}</div>}
      {meta && <div className="text-sm text-slate-500">{meta}</div>}
      {movie.genres && <div className="text-xs text-slate-500">{movie.genres}</div>}
    </Link>
  );
}
