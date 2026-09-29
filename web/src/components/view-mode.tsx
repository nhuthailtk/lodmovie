"use client";

import { useEffect, useState } from "react";

export type ViewMode = "3d" | "2d";

const STORAGE_KEY = "lod-movie:graph-view";

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** 3D by default, 2D when the viewer chose it before or when WebGL is unavailable. */
export function useViewMode() {
  const [mode, setModeState] = useState<ViewMode>("3d");
  const [webgl, setWebgl] = useState(true);
  useEffect(() => {
    const available = webglAvailable();
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      saved = null;
    }
    setWebgl(available);
    setModeState(available && saved !== "2d" ? "3d" : "2d");
  }, []);
  function setMode(next: ViewMode) {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may block storage; the choice then lasts for this page only.
    }
  }
  return { mode, setMode, webgl };
}

export function ViewToggle({ mode, setMode, webgl }: ReturnType<typeof useViewMode>) {
  return (
    <div role="group" aria-label="Diagram view" className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm dark:border-slate-700">
      {(["3d", "2d"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          disabled={option === "3d" && !webgl}
          title={option === "3d" && !webgl ? "3D needs WebGL, which this browser does not provide" : undefined}
          onClick={() => setMode(option)}
          className={`px-3 py-1.5 font-medium disabled:opacity-40 ${mode === option ? "bg-indigo-600 text-white" : "hover:text-indigo-600 dark:hover:text-indigo-400"}`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
