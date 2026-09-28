"use client";

import { useEffect, useState } from "react";
import type { WikidataFacts } from "@/lib/wikidata";

type State = { status: "loading" } | { status: "ready"; data: WikidataFacts } | { status: "error" };

/** Follows owl:sameAs to Wikidata at view time; nothing shown here is stored in the dataset. */
export default function WikidataPanel({ qid, kind, subject }: { qid: string; kind: "movie" | "person"; subject: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(`/api/wikidata/${qid}?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: WikidataFacts) => alive && setState({ status: "ready", data }))
      .catch(() => alive && setState({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [qid, kind]);
  const local = subject.split("/").slice(-2).join(":");
  return (
    <aside className="card space-y-3">
      <div>
        <h2 className="font-semibold">Live from Wikidata</h2>
        <p className="text-xs text-slate-500">
          Followed at view time via <code>{local} owl:sameAs wd:{qid}</code>; not stored in this dataset.
        </p>
      </div>
      {state.status === "loading" && <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />}
      {state.status === "error" && <p className="text-sm text-slate-500">Wikidata is not reachable right now.</p>}
      {state.status === "ready" && (
        <>
          {state.data.image && <img src={state.data.image} alt={state.data.label ?? qid} loading="lazy" className="w-full rounded-lg" />}
          {state.data.description && <p className="text-sm">{state.data.description}</p>}
          {state.data.facts.length > 0 && (
            <dl className="space-y-1 text-sm">
              {state.data.facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-4">
                  <dt className="text-slate-500">{f.label}</dt>
                  <dd className="text-right">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <a className="link" href={`https://www.wikidata.org/wiki/${qid}`} target="_blank" rel="noreferrer">Wikidata {qid}</a>
            {state.data.wikipedia && (
              <a className="link" href={state.data.wikipedia} target="_blank" rel="noreferrer">Wikipedia</a>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
