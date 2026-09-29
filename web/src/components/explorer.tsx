"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import Graph3D, { type Link3D, type Node3D } from "./graph-3d";
import { useViewMode, ViewToggle } from "./view-mode";
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

const LAYOUT: cytoscape.CoseLayoutOptions = { name: "cose", animate: false, nodeDimensionsIncludeLabels: true, randomize: false, fit: true, padding: 30 };

type Found = { iri: string; label: string; kind: string };

function to3d(node: GraphNode, expanded: boolean): Node3D {
  if (node.kind === "literal") return { id: node.id, label: node.label, color: "#94a3b8", shape: "cube", size: 2 };
  if (node.kind === "external") return { id: node.id, label: node.label, color: "#cbd5e1", shape: "wire", size: 4.5 };
  return { id: node.id, label: node.label, color: COLORS[node.cls] ?? COLORS.Other, shape: "sphere", size: expanded ? 6 : 4.5 };
}

export default function Explorer({ start }: { start: string }) {
  const view = useViewMode();
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  // The graph itself lives here, shared by the 2D and 3D views.
  const nodes = useRef(new Map<string, GraphNode>());
  const edges = useRef(new Map<string, GraphEdge>());
  const expanded = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const [showLiterals, setShowLiterals] = useState(true);
  const [status, setStatus] = useState("Loading…");
  const [fit, setFit] = useState(0);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);

  const expand = useCallback(async (iri: string) => {
    if (expanded.current.has(iri)) return;
    setStatus("Loading…");
    const response = await fetch(`/api/neighbors?uri=${encodeURIComponent(iri)}`);
    if (!response.ok) {
      setStatus("Could not load neighbours.");
      return;
    }
    expanded.current.add(iri);
    const data: { nodes: GraphNode[]; edges: GraphEdge[] } = await response.json();
    for (const node of data.nodes) if (!nodes.current.has(node.id)) nodes.current.set(node.id, node);
    for (const edge of data.edges) if (!edges.current.has(edge.id)) edges.current.set(edge.id, edge);
    setVersion((v) => v + 1);
    setStatus(`${nodes.current.size} nodes · ${edges.current.size} edges. Click a coloured node to expand it, double-click to open its page.`);
  }, []);

  const restart = useCallback(() => {
    nodes.current.clear();
    edges.current.clear();
    expanded.current.clear();
    cy.current?.elements().remove();
    setVersion((v) => v + 1);
    expand(start);
  }, [expand, start]);

  useEffect(() => {
    restart();
  }, [restart]);

  function act(id: string, action: "click" | "double") {
    const node = nodes.current.get(id);
    if (!node) return;
    if (action === "click" && node.kind === "resource") expand(id);
    if (action === "click" && node.kind === "external") window.open(id, "_blank", "noopener");
    if (action === "double" && node.kind === "resource" && node.href) window.location.href = node.href;
  }
  const actRef = useRef(act);
  actRef.current = act;

  // 2D view: build Cytoscape when the view switches to 2D.
  useEffect(() => {
    if (view.mode !== "2d") return;
    let destroyed = false;
    import("cytoscape").then(({ default: cytoscapeFactory }) => {
      if (destroyed || !host.current) return;
      const graph = cytoscapeFactory({ container: host.current, style: STYLE, wheelSensitivity: 0.2 });
      graph.on("tap", "node", (event) => actRef.current(event.target.id(), "click"));
      graph.on("dbltap", "node", (event) => actRef.current(event.target.id(), "double"));
      cy.current = graph;
      setVersion((v) => v + 1);
    });
    return () => {
      destroyed = true;
      cy.current?.destroy();
      cy.current = null;
    };
  }, [view.mode]);

  // 2D view: add whatever the shared graph has that Cytoscape does not show yet.
  useEffect(() => {
    const graph = cy.current;
    if (!graph) return;
    const fresh: cytoscape.ElementDefinition[] = [
      ...[...nodes.current.values()].filter((n) => graph.getElementById(n.id).empty()).map((data) => ({ group: "nodes" as const, data })),
      ...[...edges.current.values()].filter((e) => graph.getElementById(e.id).empty()).map((data) => ({ group: "edges" as const, data })),
    ];
    if (fresh.length) {
      graph.add(fresh);
      graph.layout(LAYOUT).run();
    }
    for (const id of expanded.current) graph.getElementById(id).addClass("expanded");
    graph.nodes('[kind = "literal"]').style("display", showLiterals ? "element" : "none");
  }, [version, showLiterals]);

  // 3D view: plain data derived from the shared graph (`version` signals that the refs changed).
  const graph3d = useMemo(() => {
    const visible = [...nodes.current.values()].filter((n) => showLiterals || n.kind !== "literal");
    const ids = new Set(visible.map((n) => n.id));
    return {
      nodes: visible.map((n) => to3d(n, expanded.current.has(n.id))),
      links: [...edges.current.values()]
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e): Link3D => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, showLiterals]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then(setFound)
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Start from a movie or person…"
            aria-label="Start from a movie or person"
            className="input w-72"
          />
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
        <ViewToggle {...view} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showLiterals} onChange={(e) => setShowLiterals(e.target.checked)} /> Show literals
        </label>
        {view.mode === "3d" && (
          <button type="button" className="btn" onClick={() => setFit((n) => n + 1)}>
            Fit view
          </button>
        )}
        <button type="button" className="btn" onClick={restart}>
          Reset
        </button>
      </div>
      <p className="text-sm text-slate-500">
        {status}
        {view.mode === "3d" && " Drag the background to rotate, scroll to zoom."}
      </p>
      {view.mode === "3d" ? (
        <Graph3D
          nodes={graph3d.nodes}
          links={graph3d.links}
          height={760}
          labelSize={4.5}
          linkDistance={70}
          fitSignal={fit}
          onNodeClick={(id) => actRef.current(id, "click")}
          onNodeDoubleClick={(id) => actRef.current(id, "double")}
        />
      ) : (
        <div ref={host} className="h-[760px] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800" />
      )}
      <ul className="flex flex-wrap gap-4 text-xs text-slate-500">
        {Object.entries(COLORS).map(([name, color]) => (
          <li key={name} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} /> {name}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-slate-500" /> External (Wikidata, DBpedia, IMDb)
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 bg-slate-300" /> Literal
        </li>
      </ul>
    </div>
  );
}
