"use client";

import { useEffect, useRef, useState } from "react";
import type { Example } from "@/lib/examples";

type YasguiTab = { setQuery(query: string): unknown; query(): Promise<unknown> };
type YasguiInstance = { getTab(): YasguiTab | undefined };
type YasguiConstructor = new (element: HTMLElement, config: object) => YasguiInstance;

declare global {
  interface Window {
    Yasgui?: YasguiConstructor;
  }
}

let loading: Promise<YasguiConstructor> | null = null;

/** YASGUI is loaded as its prebuilt browser bundle (copied to /vendor by prepare-data). */
function loadYasgui(): Promise<YasguiConstructor> {
  if (window.Yasgui) return Promise.resolve(window.Yasgui);
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/vendor/yasgui/yasgui.min.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = "/vendor/yasgui/yasgui.min.js";
    script.onload = () => (window.Yasgui ? resolve(window.Yasgui) : reject(new Error("Yasgui missing")));
    script.onerror = () => reject(new Error("Yasgui failed to load"));
    document.body.appendChild(script);
  });
  return loading;
}

export default function SparqlEditor({ examples }: { examples: Example[] }) {
  const host = useRef<HTMLDivElement>(null);
  const yasgui = useRef<YasguiInstance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadYasgui()
      .then((Yasgui) => {
        if (cancelled || !host.current || yasgui.current) return;
        const initial = new URLSearchParams(window.location.search).get("q") ?? examples[0]?.query ?? "";
        yasgui.current = new Yasgui(host.current, {
          requestConfig: { endpoint: `${window.location.origin}/sparql`, method: "POST" },
          copyEndpointOnNewTab: false,
          persistenceId: null,
          populateFromUrl: false,
        });
        yasgui.current.getTab()?.setQuery(initial);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [examples]);

  function run(query: string) {
    const tab = yasgui.current?.getTab();
    if (!tab) return;
    tab.setQuery(query);
    tab.query();
    host.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <aside className="space-y-3">
        <h2 className="font-semibold">Example queries</h2>
        <ul className="space-y-3">
          {examples.map((example) => (
            <li key={example.title}>
              <button type="button" onClick={() => run(example.query)} className="link text-left text-sm font-medium">
                {example.title}
              </button>
              <p className="text-xs text-slate-500">{example.description}</p>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 rounded-xl bg-white p-2 text-slate-900">
        {failed && <p className="p-4 text-sm">The query editor could not be loaded. The endpoint still works — see the curl example below.</p>}
        <div ref={host} />
      </div>
    </div>
  );
}
