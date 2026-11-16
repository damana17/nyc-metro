import React, { useState } from "react";
import GameContracts from "./components/GameContracts";
import GameInfluence from "./components/GameInfluence";

export default function App() {
  const [version, setVersionState] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("g") === "contracts" ? "contracts" : "influence"; } catch (e) { return "influence"; }
  });
  const setVersion = (v) => {
    setVersionState(v);
    try { const u = new URL(window.location.href); u.searchParams.delete("t"); if (v === "contracts") u.searchParams.set("g", v); else u.searchParams.delete("g"); window.history.replaceState(null, "", u.toString()); } catch (e) { /* ignore */ }
  };
  const [slot, setSlot] = useState(null);   // V2 puts its table controls in the top bar

  return (
    <div className="w-full min-h-screen flex flex-col bg-[#F2F1EC]">
      <header className="sticky top-0 z-30 bg-black text-white shrink-0">
        <div className="min-h-12 px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-[13px] font-bold">M</span>
            <span className="text-[17px] font-bold tracking-tight">NYC Metro</span>
          </span>
          <div className="flex rounded-md overflow-hidden border border-white/25 text-[12px] font-semibold">
            {[["influence", "Influence"], ["contracts", "Contracts (V1)"]].map(([k, l]) => (
              <button key={k} onClick={() => setVersion(k)}
                className={`px-2.5 h-7 ${version === k ? "bg-white text-black" : "text-white/70 hover:text-white"}`}>{l}</button>
            ))}
          </div>
          <div ref={setSlot} className="ml-auto flex items-center min-w-0" />
        </div>
      </header>
      <div className="v1" style={{ display: version === "contracts" ? "block" : "none" }}>
        <GameContracts hidden={version !== "contracts"} />
      </div>
      <GameInfluence hidden={version !== "influence"} slot={version === "influence" ? slot : null} />
    </div>
  );
}
