"use client";

import { useEffect, useRef, useState } from "react";
import type ForceGraph3D from "3d-force-graph";
import type SpriteTextClass from "three-spritetext";

export type Node3D = { id: string; label: string; color: string; shape?: "sphere" | "wire" | "cube"; size?: number };
export type Link3D = { id: string; source: string; target: string; label?: string; faint?: boolean };

type Instance = InstanceType<typeof ForceGraph3D>;
type Three = typeof import("three");
type SimNode = Node3D & { x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number };
type SimLink = Omit<Link3D, "source" | "target"> & { source: string | SimNode; target: string | SimNode; curvature: number };
type Point = { x: number; y: number; z: number };
type OrbitControls = { autoRotate: boolean; autoRotateSpeed: number; addEventListener(type: string, listener: () => void): void };

type Props = {
  nodes: Node3D[];
  links: Link3D[];
  height: number;
  /** Draw link labels as text in the scene (otherwise they appear on hover). */
  linkLabels?: boolean;
  /** Change this number to re-fit the camera. */
  fitSignal?: number;
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  /** Height of node labels in scene units. */
  labelSize?: number;
  /** Height of link labels (when linkLabels is on). */
  linkLabelSize?: number;
  /** Preferred distance between linked nodes; larger spreads the graph out. */
  linkDistance?: number;
};

type Sizes = { label: number };

function makeNode(THREE: Three, SpriteText: typeof SpriteTextClass, node: SimNode, sizes: Sizes) {
  const size = node.size ?? 5;
  const group = new THREE.Group();
  const geometry =
    node.shape === "cube" ? new THREE.BoxGeometry(size * 1.5, size * 1.5, size * 1.5) : new THREE.SphereGeometry(size, 20, 14);
  const material = new THREE.MeshLambertMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: 0.35,
    wireframe: node.shape === "wire",
    transparent: node.shape === "wire",
    opacity: node.shape === "wire" ? 0.8 : 1,
  });
  group.add(new THREE.Mesh(geometry, material));
  const label = new SpriteText(node.label, node.shape === "cube" ? sizes.label * 0.7 : sizes.label, "#f1f5f9");
  label.fontWeight = "600";
  label.backgroundColor = "rgba(15,23,42,0.7)";
  label.padding = [2, 1];
  label.borderRadius = 2;
  label.position.y = size + sizes.label * 0.9;
  group.add(label);
  return group;
}

/** Links between the same two nodes get different curvatures so they (and their labels) do not overlap. */
function withCurvature(links: Link3D[]): (Link3D & { curvature: number })[] {
  const groups = new Map<string, Link3D[]>();
  for (const link of links) {
    const key = [link.source, link.target].sort().join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  return links.map((link) => {
    const group = groups.get([link.source, link.target].sort().join("\u0000"))!;
    const index = group.indexOf(link);
    return { ...link, curvature: group.length === 1 ? 0 : 0.35 * (index - (group.length - 1) / 2) };
  });
}

/** Force-directed 3D graph (three.js / WebGL). Loaded only in the browser, only when rendered. */
export default function Graph3D({
  nodes,
  links,
  height,
  linkLabels = false,
  fitSignal = 0,
  onNodeClick,
  onNodeDoubleClick,
  labelSize = 4,
  linkLabelSize = 2.5,
  linkDistance = 60,
}: Props) {
  // The canvas sits absolutely inside a fixed-size frame, so it can never widen the page layout.
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const graph = useRef<Instance | null>(null);
  const nodeObjects = useRef(new Map<string, SimNode>());
  const linkObjects = useRef(new Map<string, SimLink>());
  const pendingFit = useRef(true);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  const handlers = useRef({ onNodeClick, onNodeDoubleClick, linkLabels });
  handlers.current = { onNodeClick, onNodeDoubleClick, linkLabels };
  const sizes = useRef({ labelSize, linkLabelSize, linkDistance });
  sizes.current = { labelSize, linkLabelSize, linkDistance };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const nodesMap = nodeObjects.current;
    const linksMap = linkObjects.current;
    Promise.all([import("3d-force-graph"), import("three-spritetext"), import("three")]).then(
      ([{ default: ForceGraph }, { default: SpriteText }, THREE]) => {
        const element = host.current;
        const outer = frame.current;
        if (disposed || !element || !outer) return;
        const fit = () => instance.zoomToFit(600, 50);
        const click = (id: string) => {
          const now = Date.now();
          const previous = lastClick.current;
          lastClick.current = { id, at: now };
          if (previous && previous.id === id && now - previous.at < 350) {
            lastClick.current = null;
            handlers.current.onNodeDoubleClick?.(id);
          } else {
            handlers.current.onNodeClick?.(id);
          }
        };
        const instance = new ForceGraph(element, { controlType: "orbit" })
          .width(outer.clientWidth)
          .height(outer.clientHeight)
          .backgroundColor("#0f172a")
          .showNavInfo(false)
          .nodeLabel((node) => (node as SimNode).label)
          .nodeThreeObject((node) => makeNode(THREE, SpriteText, node as SimNode, { label: sizes.current.labelSize }))
          .linkColor((link) => ((link as SimLink).faint ? "rgba(148,163,184,0.45)" : "#94a3b8"))
          .linkOpacity(0.7)
          .linkWidth(0.8)
          .linkCurvature((link) => (link as SimLink).curvature)
          .linkDirectionalArrowLength(5)
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalParticles((link) => ((link as SimLink).faint ? 2 : 0))
          .linkDirectionalParticleWidth(1.2)
          .linkLabel((link) => (link as SimLink).label ?? "")
          .linkThreeObjectExtend(true)
          .linkThreeObject((link) => {
            const { label } = link as SimLink;
            if (!handlers.current.linkLabels || !label) return new THREE.Object3D();
            const text = new SpriteText(label, sizes.current.linkLabelSize, "#a5b4fc");
            text.backgroundColor = "rgba(15,23,42,0.6)";
            text.padding = 1;
            return text;
          })
          .linkPositionUpdate((object, { start, end }, link) => {
            const curve = (link as { __curve?: { getPoint(t: number): Point } }).__curve;
            const middle = curve ? curve.getPoint(0.5) : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
            object.position.set(middle.x, middle.y, middle.z);
          })
          .onNodeClick((node) => click(String(node.id)))
          .onNodeDragEnd((node) => {
            node.fx = node.x;
            node.fy = node.y;
            node.fz = node.z;
          })
          .onEngineStop(() => {
            if (!pendingFit.current) return;
            pendingFit.current = false;
            fit();
          });
        instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        (instance.d3Force("link") as { distance?: (d: number) => unknown } | undefined)?.distance?.(sizes.current.linkDistance);
        (instance.d3Force("charge") as { strength?: (s: number) => unknown } | undefined)?.strength?.(-sizes.current.linkDistance * 4);
        const controls = instance.controls() as OrbitControls;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.8;
        controls.addEventListener("start", () => {
          controls.autoRotate = false;
          touched.current = true;
        });
        observer = new ResizeObserver(() => {
          instance.width(outer.clientWidth).height(outer.clientHeight);
          if (!touched.current) fit();
        });
        observer.observe(outer);
        graph.current = instance;
        setReady(true);
      },
    );
    return () => {
      disposed = true;
      observer?.disconnect();
      graph.current?._destructor();
      graph.current = null;
      nodesMap.clear();
      linksMap.clear();
      setReady(false);
    };
  }, [height]);

  // Merge new props into the simulation, reusing existing node objects so the layout does not jump.
  useEffect(() => {
    const instance = graph.current;
    if (!ready || !instance) return;
    const ids = new Set(nodes.map((n) => n.id));
    const simNodes = nodes.map((node) => {
      const existing = nodeObjects.current.get(node.id);
      if (existing) return existing;
      const created: SimNode = { ...node };
      nodeObjects.current.set(node.id, created);
      pendingFit.current = true;
      return created;
    });
    for (const id of [...nodeObjects.current.keys()]) if (!ids.has(id)) nodeObjects.current.delete(id);
    const visible = withCurvature(links.filter((l) => ids.has(l.source) && ids.has(l.target)));
    const linkIds = new Set(visible.map((l) => l.id));
    const simLinks = visible.map((link) => {
      const existing = linkObjects.current.get(link.id);
      if (existing) {
        existing.curvature = link.curvature;
        return existing;
      }
      const created: SimLink = { ...link };
      linkObjects.current.set(link.id, created);
      return created;
    });
    for (const id of [...linkObjects.current.keys()]) if (!linkIds.has(id)) linkObjects.current.delete(id);
    instance.graphData({ nodes: simNodes, links: simLinks });
  }, [ready, nodes, links]);

  useEffect(() => {
    if (fitSignal) graph.current?.zoomToFit(600, 50);
  }, [fitSignal]);

  return (
    <div ref={frame} style={{ height }} className="relative w-full min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div ref={host} className="absolute inset-0" />
    </div>
  );
}
