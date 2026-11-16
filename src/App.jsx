import React, { useState } from "react";
import GameContracts from "./components/GameContracts";
import GameInfluence from "./components/GameInfluence";

export default function App() {
  const [version, setVersion] = useState("influence");
  return (
    <div className="w-full min-h-screen" style={{ background: "#F1F1D3", fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');`}</style>
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-3 border-b-2 border-stone-800">
        <h1 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xl font-bold tracking-tight">NYC METRO</h1>
        <div className="flex rounded-sm overflow-hidden border-2 border-stone-800">
          {[["contracts", "V1 · Contracts"], ["influence", "V2 · Influence"]].map(([k, l]) => (
            <button key={k} onClick={() => setVersion(k)}
              className={`px-3 py-1.5 text-sm font-medium ${version === k ? "bg-stone-800 text-stone-50" : "hover:bg-white/60"}`}>{l}</button>
          ))}
        </div>
        <span className="text-xs text-stone-600">
          {version === "contracts"
            ? "Players are corporations. Contracts are auctioned; lines earn once open."
            : "Players are investors. Seven neutral lines, influence discs, shares."}
        </span>
      </div>
      <GameContracts hidden={version !== "contracts"} />
      <GameInfluence hidden={version !== "influence"} />
    </div>
  );
}
