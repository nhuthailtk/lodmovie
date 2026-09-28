import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="text-3xl font-bold">Not found</h1>
      <p className="text-slate-600 dark:text-slate-300">This resource is not part of the LOD Movie dataset.</p>
      <p>
        <Link className="link" href="/">Home</Link> · <Link className="link" href="/search">Search</Link>
      </p>
    </div>
  );
}
