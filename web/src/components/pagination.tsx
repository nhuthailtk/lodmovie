import Link from "next/link";

type Props = { page: number; total: number; perPage: number; basePath: string; params: Record<string, string> };

export default function Pagination({ page, total, perPage, basePath, params }: Props) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams({ ...params, page: String(target) });
    for (const [key, value] of [...query]) if (!value) query.delete(key);
    return `${basePath}?${query}`;
  };
  return (
    <nav className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <span className="text-slate-500">
        Page {page} of {pages} · {total.toLocaleString("en-US")} results
      </span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn" href={href(page - 1)}>← Previous</Link>}
        {page < pages && <Link className="btn" href={href(page + 1)}>Next →</Link>}
      </div>
    </nav>
  );
}
