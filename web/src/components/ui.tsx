import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 space-y-2">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">{eyebrow}</p>}
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="max-w-3xl space-y-2 text-slate-600 dark:text-slate-300">{children}</div>}
    </header>
  );
}

export function Section({ title, id, action, children }: { title: string; id?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const body = (
    <>
      <div className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card block hover:border-indigo-400">{body}</Link>
  ) : (
    <div className="card">{body}</div>
  );
}

export function Chip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900">
      {children}
    </Link>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="card">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link break-all">
      {children}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-slate-500">{children}</p>;
}
