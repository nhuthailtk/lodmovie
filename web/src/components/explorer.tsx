"use client";

import { useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import type { GraphEdge, GraphNode } from "@/lib/graph";

const COLORS: Record<string, string> = {
  Movie: "#4f46e5",
  Person: "#059669",
  Credit: "#d97706",
  Genre: "#db2777",
  Profession: "#0284c7",
  Ontology: "#7c3aed",
  Other: "#475569",
};

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "background-color": (node: cytoscape.NodeSingular) => COLORS[node.data("cls")] ?? COLORS.Other,
      width: 26,
      height: 26,
      "font-size": 10,
      color: "#1e293b",
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.85,
      "text-background-padding": "1px",
    },
  },
  { selector: 'node[kind = "external"]', style: { "background-color": "#ffffff", "border-width": 2, "border-color": "#64748b", "border-style": "dashed" } },
  { selector: 'node[kind = "literal"]', style: { shape: "round-rectangle", "background-color": "#e2e8f0", width: 14, height: 14, color: "#475569" } },
  { selector: "node.expanded", style: { "border-width": 3, "border-color": "#0f172a" } },
  {
    selector: "edge",
    style: {
      label: "data(label)",
      width: 1,
      "curve-style": "bezier",
      "line-color": "#cbd5e1",
      "target-arrow-color": "#cbd5e1",
      "target-arrow-shape": "triangle",
      "font-size": 8,
      color: "#64748b",
      "text-rotation": "autorotate",
    },
  },
];

type Found = { iri: string; label: string; kind: string };

export default function Explorer({ start }: { start: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const expanded = useRef(new Set<string>());
  const [showLiterals, setShowLiterals] = useState(true);
  const [status, setStatus] = useState("Loading…");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const showLiteralsRef = useRef(showLiterals);
  showLiteralsRef.current = showLiterals;

  async function expand(iri: string) {
    const graph = cy.current;
    if (!graph || expanded.current.has(iri)) return;
    expanded.current.add(iri);
    setStatus("Loading…");
    const response = await fetch(`/api/neighbors?uri=${encodeURIComponent(iri)}`);
    if (!response.ok) return setStatus("Could not load neighbours.");
    const data: { nodes: GraphNode[]; edges: GraphEdge[] } = await response.json();
    const fresh = [
      ...data.nodes.filter((n) => graph.getElementById(n.id).empty()).map((n) => ({ group: "nodes" as const, data: n })),
      ...data.edges.filter((e) => graph.getElementById(e.id).empty()).map((e) => ({ group: "edges" as const, data: e })),
    ];
    graph.add(fresh);
    graph.getElementById(iri).addClass("expanded");
    graph.nodes('[kind = "literal"]').style("display", showLiteralsRef.current ? "element" : "none");
    graph.layout({ name: "cose", animate: false, nodeDimensionsIncludeLabels: true, randomize: false, fit: true, padding: 30 }).run();
    setStatus(`${graph.nodes().length} nodes · ${graph.edges().length} edges. Click a coloured node to expand it, double-click to open its page.`);
  }

  useEffect(() => {
    let destroyed = false;
    const seen = expanded.current;
    import("cytoscape").then(({ default: cytoscapeFactory }) => {
      if (destroyed || !host.current) return;
      const graph = cytoscapeFactory({ container: host.current, style: STYLE, wheelSensitivity: 0.2 });
      graph.on("tap", "node", (event) => {
        const data = event.target.data() as GraphNode;
        if (data.kind === "resource") expand(data.id);
        if (data.kind === "external") window.open(data.id, "_blank", "noopener");
      });
      graph.on("dbltap", "node", (event) => {
        const data = event.target.data() as GraphNode;
        if (data.kind === "resource" && data.href) window.location.href = data.href;
      });
      cy.current = graph;
      expand(start);
    });
    return () => {
      destroyed = true;
      seen.clear();
      cy.current?.destroy();
      cy.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    cy.current?.nodes('[kind = "literal"]').style("display", showLiterals ? "element" : "none");
  }, [showLiterals]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setFound).catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function reset() {
    cy.current?.elements().remove();
    expanded.current.clear();
    expand(start);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start from a movie or person…" className="input w-72" />
          {found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white text-sm text-slate-900 shadow-lg">
              {found.map((f) => (
                <li key={f.iri}>
                  <a className="block px-3 py-1.5 hover:bg-slate-100" href={`/explore?uri=${encodeURIComponent(f.iri)}`}>
                    {f.label} <span className="text-xs text-slate-500">{f.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showLiterals} onChange={(e) => setShowLiterals(e.target.checked)} /> Show literals
        </label>
        <button type="button" className="btn" onClick={reset}>Reset</button>
      </div>
      <p className="text-sm text-slate-500">{status}</p>
      <div ref={host} className="h-[620px] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800" />
      <ul className="flex flex-wrap gap-4 text-xs text-slate-500">
        {Object.entries(COLORS).map(([name, color]) => (
          <li key={name} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} /> {name}
          </li>
        ))}
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-slate-500" /> External (Wikidata, DBpedia, IMDb)</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-slate-200" /> Literal</li>
      </ul>
    </div>
  );
}
