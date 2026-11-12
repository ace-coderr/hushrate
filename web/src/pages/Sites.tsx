import { useRef, useState } from "react";
import { validateSite, type Site } from "@hushrate/core";
import { PageHead } from "../components/Layout";
import { useLatest } from "../lib/data";
import { SAMPLE_FLEET, useStore } from "../lib/store";

const blank = (n: number): Site => ({ name: `My site ${n}`, node: "TH_SP15_GEN-APND", power_mw: 10, efficiency_j_per_th: 20, power_adder_usd_per_mwh: 10, min_margin_usd_per_day: 0 });
const numVal = (v: number) => (Number.isFinite(v) ? v : "");

export function Sites() {
  const { sites, isSample, saveSites, resetToSample } = useStore();
  const latest = useLatest();
  const [draft, setDraft] = useState<Site[]>(sites);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const nodes = latest.data?.power.map((p) => p.node) ?? [];
  const errs = draft.map((s) => validateSite(s));
  const valid = draft.length > 0 && errs.every((e) => e.length === 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(sites);

  const upd = (i: number, p: Partial<Site>) => { setMsg(null); setDraft((d) => d.map((s, k) => (k === i ? { ...s, ...p } : s))); };

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ sites: draft }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "hushrate-sites.json"; a.click(); URL.revokeObjectURL(url);
  };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const list: Site[] = Array.isArray(j) ? j : j.sites;
      if (!Array.isArray(list) || !list.length) throw new Error("expected a list of sites");
      const bad = list.map((s, i) => ({ i, e: validateSite(s) })).filter((x) => x.e.length);
      if (bad.length) throw new Error(`site ${bad[0].i + 1}: ${bad[0].e.join("; ")}`);
      setDraft(list.map((s) => ({ name: String(s.name), node: String(s.node), power_mw: s.power_mw, efficiency_j_per_th: s.efficiency_j_per_th, power_adder_usd_per_mwh: s.power_adder_usd_per_mwh, min_margin_usd_per_day: s.min_margin_usd_per_day })));
      setMsg(`Imported ${list.length} site(s). Press Save to keep them.`);
    } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); }
    if (file.current) file.current.value = "";
  };

  return (
    <>
      <PageHead kicker="Sites" title="Your sites, kept in your browser.">
        Describe each site once. Decisions are computed in the page from the public market tape, so nothing you type here is ever sent anywhere.
      </PageHead>

      {isSample && <div className="notice">You are looking at the <b>sample fleet</b>: demo assumptions, not customers and not measurements. Edit them or add your own, then press Save.</div>}
      {msg && <div className="notice" role="status">{msg}</div>}

      <datalist id="nodes">{nodes.map((n) => <option key={n} value={n} />)}</datalist>

      <div className="site-list">
        {draft.map((s, i) => (
          <fieldset key={i} className="card site-edit">
            <legend>Site {i + 1}</legend>
            <label className="field">Name<input value={s.name} onChange={(e) => upd(i, { name: e.target.value })} /></label>
            <label className="field">Pricing node<input list="nodes" value={s.node} onChange={(e) => upd(i, { node: e.target.value })} /><small>CAISO node id. Nodes on the tape: {nodes.join(", ") || "none yet"}.</small></label>
            <label className="field">Load (MW)<input type="number" min="0" step="0.1" value={numVal(s.power_mw)} onChange={(e) => upd(i, { power_mw: e.target.valueAsNumber })} /></label>
            <label className="field">Efficiency (J/TH)<input type="number" min="0" step="0.1" value={numVal(s.efficiency_j_per_th)} onChange={(e) => upd(i, { efficiency_j_per_th: e.target.valueAsNumber })} /></label>
            <label className="field">Power adder ($/MWh)<input type="number" step="0.5" value={numVal(s.power_adder_usd_per_mwh)} onChange={(e) => upd(i, { power_adder_usd_per_mwh: e.target.valueAsNumber })} /><small>Delivery, fees and overhead on top of the market price.</small></label>
            <label className="field">Minimum margin ($/day)<input type="number" step="1" value={numVal(s.min_margin_usd_per_day)} onChange={(e) => upd(i, { min_margin_usd_per_day: e.target.valueAsNumber })} /><small>Run only if the margin is above this.</small></label>
            {errs[i].length > 0 && <ul className="errors" role="alert">{errs[i].map((e) => <li key={e}>{e}</li>)}</ul>}
            <button className="pill ghost small-btn" disabled={draft.length === 1} onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}>Remove site</button>
          </fieldset>
        ))}
      </div>

      <div className="cta-row sticky-actions">
        <button className="pill primary" disabled={!valid || !dirty} onClick={() => { saveSites(draft); setMsg("Saved in this browser."); }}>Save sites</button>
        <button className="pill ghost" onClick={() => setDraft((d) => [...d, blank(d.length + 1)])}>Add a site</button>
        <button className="pill ghost" onClick={exportJson} disabled={!valid}>Export JSON</button>
        <button className="pill ghost" onClick={() => file.current?.click()}>Import JSON</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        {!isSample && <button className="pill ghost" onClick={() => { resetToSample(); setDraft(SAMPLE_FLEET); setMsg("Restored the sample fleet."); }}>Back to sample fleet</button>}
      </div>
    </>
  );
}
