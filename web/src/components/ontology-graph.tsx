"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import Graph3D, { type Link3D, type Node3D } from "./graph-3d";
import { useViewMode, ViewToggle } from "./view-mode";
import type { DiagramEdge, DiagramNode } from "@/lib/ontology";

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      shape: "round-rectangle",
      width: (node: cytoscape.NodeSingular) => Math.max(70, String(node.data("label")).length * 7.5 + 24),
      height: 34,
      "background-color": "#4f46e5",
      color: "#ffffff",
      "font-size": 12,
      "text-valign": "center",
      "text-halign": "center",
    },
  },
  {
    selector: "node[?external]",
    style: { "background-color": "#f1f5f9", color: "#334155", "border-width": 1, "border-style": "dashed", "border-color": "#64748b" },
  },
  { selector: "node:selected", style: { "border-width": 3, "border-color": "#f59e0b", "border-style": "solid" } },
  {
    selector: "edge",
    style: {
      label: "data(label)",
      width: 1.5,
      "curve-style": "bezier",
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      "target-arrow-shape": "triangle",
      "font-size": 10,
      color: "#334155",
      "text-rotation": "autorotate",
      "text-background-color": "#ffffff",
      "text-background-opacity": 1,
      "text-background-padding": "2px",
    },
  },
  { selector: 'edge[kind = "subclass"], edge[kind = "equivalent"]', style: { "line-style": "dashed", "target-arrow-shape": "triangle-backcurve" } },
];

const LAYOUT: cytoscape.CoseLayoutOptions = { name: "cose", animate: false, nodeDimensionsIncludeLabels: true, idealEdgeLength: () => 140, nodeRepulsion: () => 12000, padding: 30 };

export default function OntologyGraph({ nodes, edges }: { nodes: DiagramNode[]; edges: DiagramEdge[] }) {
  const host = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const [selected, setSelected] = useState<DiagramNode | null>(null);
  const [fit, setFit] = useState(0);
  const view = useViewMode();

  const nodes3d = useMemo(
    () =>
      nodes.map((n): Node3D => ({
        id: n.id,
        label: n.label,
        color: n.external ? "#cbd5e1" : "#6366f1",
        shape: n.external ? "wire" : "sphere",
        size: n.external ? 6 : 9,
      })),
    [nodes],
  );
  const links3d = useMemo(
    () => edges.map((e): Link3D => ({ id: e.id, source: e.source, target: e.target, label: e.label, faint: e.kind !== "object" })),
    [edges],
  );

  useEffect(() => {
    if (view.mode !== "2d") return;
    let destroyed = false;
    import("cytoscape").then(({ default: cytoscapeFactory }) => {
      if (destroyed || !host.current) return;
      const instance = cytoscapeFactory({
        container: host.current,
        elements: [...nodes.map((data) => ({ data })), ...edges.map((data) => ({ data }))],
        style: STYLE,
        layout: LAYOUT,
        wheelSensitivity: 0.2,
      });
      instance.on("tap", "node", (event) => setSelected(nodes.find((n) => n.id === event.target.id()) ?? null));
      instance.on("tap", (event) => {
        if (event.target === instance) setSelected(null);
      });
      cy.current = instance;
    });
    return () => {
      destroyed = true;
      cy.current?.destroy();
      cy.current = null;
    };
  }, [nodes, edges, view.mode]);

  function reset() {
    if (view.mode === "3d") setFit((n) => n + 1);
    else cy.current?.layout(LAYOUT).run();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ViewToggle {...view} />
        <button type="button" className="btn" onClick={reset}>
          {view.mode === "3d" ? "Fit view" : "Reset layout"}
        </button>
        {view.mode === "2d" && (
          <span className="text-sm text-slate-500">Drag nodes to rearrange, scroll to zoom, click a class for details.</span>
        )}
      </div>
      <div className="relative min-w-0">
        {view.mode === "3d" ? (
          <Graph3D
            nodes={nodes3d}
            links={links3d}
            height={760}
            linkLabels
            labelSize={7}
            linkLabelSize={4}
            linkDistance={120}
            fitSignal={fit}
            onNodeClick={(id) => setSelected(nodes.find((n) => n.id === id) ?? null)}
            onNodeDoubleClick={(id) => {
              const node = nodes.find((n) => n.id === id);
              if (node && !node.external) window.location.hash = node.label;
            }}
          />
        ) : (
          <div ref={host} className="h-[760px] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800" />
        )}
        {selected && (
          <aside className="absolute right-3 top-3 w-72 max-w-[calc(100%-1.5rem)] space-y-2 rounded-xl border border-slate-200 bg-white/95 p-4 text-sm text-slate-900 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{selected.label}</h3>
              <button type="button" aria-label="Close" className="text-slate-500 hover:text-slate-900" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            {selected.external ? (
              <p className="text-slate-500">External vocabulary term this ontology aligns to.</p>
            ) : (
              <>
                {selected.comment && <p>{selected.comment}</p>}
                <h4 className="pt-2 text-xs uppercase tracking-wide text-slate-500">Datatype properties</h4>
                {selected.datatypeProps.length ? (
                  <ul className="space-y-1 font-mono text-xs">{selected.datatypeProps.map((p) => <li key={p}>{p}</li>)}</ul>
                ) : (
                  <p className="text-slate-500">None.</p>
                )}
                <a className="text-indigo-600 hover:underline" href={`#${selected.label}`}>Documentation ↓</a>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
