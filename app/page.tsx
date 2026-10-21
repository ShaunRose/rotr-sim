"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createVessel, encounter, hull, scenario, STEP, WORLD } from "./sim/model.mjs";
import { createSimulation, advanceSimulation, observe, defaultSettings, emitSignal, type Settings, type ShipId } from "./sim/watchkeeping.mjs";
import { rangeText, feet, longTons, bearingText, tcpaText } from "./sim/units.mjs";
import Watchkeeping from "./sim/watchkeeping-panel";

const OceanScene = dynamic(() => import("./sim/ocean-scene"), { ssr: false, loading: () => <div className="ocean-loading">Preparing the 3D ocean...</div> });

export default function Home() {
  const [state, setState] = useState(createSimulation);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [rudder, setRudder] = useState(0);
  const [rate, setRate] = useState(1);
  const [settings, setSettings] = useState(defaultSettings);
  const settingsRef = useRef(defaultSettings());
  const [{ vessel, error }] = useState(() => {
    try { return { vessel: createVessel(), error: "" }; }
    catch (e) { return { vessel: null, error: e instanceof Error ? e.message : String(e) }; }
  });
  const live = useRef(createSimulation());
  const command = useRef({ speed, rudder, rate });
  useEffect(() => { command.current = { speed, rudder, rate }; }, [speed, rudder, rate]);
  useEffect(() => {
    if (!running) return;
    let frame = 0, previous = 0, accumulated = 0, lastDisplay = 0;
    const tick = (now: number) => {
      if (previous) accumulated += Math.min((now - previous) / 1000, 0.1) * command.current.rate;
      previous = now;
      while (accumulated >= STEP) {
        live.current = advanceSimulation(live.current, command.current, STEP, settingsRef.current);
        accumulated -= STEP;
        if (live.current.collision) {
          setState(live.current);
          setRunning(false);
          return;
        }
      }
      if (now - lastDisplay >= 50) { setState(live.current); lastDisplay = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
  const reset = () => {
    setRunning(false); command.current = { speed: 20, rudder: 0, rate };
    live.current = createSimulation(settingsRef.current); setState(live.current);
    setSpeed(20); setRudder(0);
  };
  const changeSettings = (next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    live.current = { ...live.current, bridge: observe(live.current, live.current.bridge, next, command.current) };
    setState(live.current);
  };
  const signal = (ship: ShipId, kind: "horn" | "vhf") => {
    live.current = emitSignal(live.current, settingsRef.current, ship, kind);
    setState(live.current);
  };
  const approach = encounter(state);
  const close = approach.dcpa < 50 && approach.tcpa > 0;
  const outside = [state.own, state.target].some(b => b.x < 0 || b.x > WORLD.width || b.y < 0 || b.y > WORLD.height);
  const clock = `${Math.floor((state.time + 1e-6) / 60).toString().padStart(2, "0")}:${Math.floor((state.time + 1e-6) % 60).toString().padStart(2, "0")}`;

  return <main className="sim-shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="ROTR simulation home"><span className="brand-mark">R</span><span>ROTR<span className="brand-light"> / SIM</span></span></Link>
      <span className="environment"><i /> LOCAL SIMULATION</span>
    </header>
    <section className="heading"><div><p className="eyebrow">NAVIGATION LAB / SCENARIO 001</p><h1>{scenario.title}</h1><p>{scenario.description}</p></div><div className="engine-badge">POWERED BY <strong>Vessel.js</strong></div></section>
    <div className="workspace">
      <section className="chart-panel" aria-label="3D ocean simulation">
        <div className="chart-toolbar"><div className="chart-actions"><button className="primary" disabled={!vessel || !!error || !!state.collision} onClick={() => setRunning(!running)}>{running ? "Pause" : "Run"}</button><button onClick={reset}>Reset</button><label className="rate">Time scale <select value={rate} onChange={e => setRate(Number(e.target.value))}><option value="1">1x</option><option value="5">5x</option><option value="10">10x</option><option value="20">20x</option></select></label></div><span className="clock">T + {clock}</span></div>
        {state.collision && <div className="collision-banner" role="alert"><div><strong>Collision detected</strong><p>Hull contact at {state.collision.time.toFixed(1)} s. Simulation paused. Reset to try another maneuver.</p></div><button onClick={reset}>Restart encounter</button></div>}
        <div className="chart-wrap">
          <OceanScene simulation={live} snapshot={state} settings={settings} onSettings={changeSettings} onSignal={signal} />
        </div>
      </section>
      <aside>
        <section className="panel"><div className="panel-title"><h2>Ship 1 manual controls</h2><span className="tag">MANUAL</span></div><p className="muted">Naval vessel / Ship 01</p>
          <div className="readouts"><div><strong>{state.own.speed.toFixed(1)}<small>kt</small></strong><span>Speed over water</span></div><div><strong>{bearingText(state.own.heading)}</strong><span>Heading</span></div></div>
          <label className="slider-label" htmlFor="speed">Target speed <strong>{speed} kt</strong></label><input id="speed" disabled={!!state.collision} type="range" min="0" max="30" step="0.5" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><div className="range-labels"><span>STOP</span><span>30 KT</span></div>
          <label className="slider-label" htmlFor="rudder">Rudder <strong>{rudder === 0 ? "Amidships" : `${Math.abs(rudder)}° ${rudder < 0 ? "port" : "starboard"}`}</strong></label><input id="rudder" disabled={!!state.collision} type="range" min="-35" max="35" value={rudder} onChange={e => setRudder(Number(e.target.value))} /><div className="range-labels"><span>PORT</span><button className="text-button" disabled={!!state.collision} onClick={() => setRudder(0)}>Center rudder</button><span>STARBOARD</span></div><div className="helm-actions"><button disabled={!!state.collision} onClick={() => signal("own", "horn")}>Sound Ship 1 horn</button></div>
        </section>
        <section className="panel"><div className="panel-title"><h2>Encounter / ground truth</h2><span className={`tag ${state.collision ? "danger" : close ? "amber" : ""}`}>{state.collision ? "COLLISION" : close ? "CLOSE APPROACH" : "MONITORING"}</span></div><dl><div><dt>Target range</dt><dd>{rangeText(approach.range)}</dd></div><div><dt>Closest approach</dt><dd>{rangeText(approach.dcpa)}</dd></div><div><dt>Time to closest approach</dt><dd>{approach.tcpa > 0 ? tcpaText(approach.tcpa) : "Now / opening"}</dd></div></dl><p className="note">Prediction assumes both vessels hold their present course and speed.</p></section>
        <section className="panel hull-panel"><div className="panel-title"><h2>Vessel model</h2><span className="tag">VESSEL.JS</span></div><dl><div><dt>Length / beam</dt><dd>{feet(hull.length).toFixed(1)} / {feet(hull.beam).toFixed(1)} ft</dd></div><div><dt>Design draft</dt><dd>{feet(hull.draft).toFixed(1)} ft</dd></div><div><dt>Displacement</dt><dd>{vessel ? `${longTons(vessel.displacement).toFixed(1)} LT` : "Loading..."}</dd></div></dl><p className="note">Box hull hydrostatics from Vessel.js. Motion uses a simplified steering model.</p></section>
      </aside>
    </div>
    <Watchkeeping state={state} ownCommand={{ speed, rudder }} settings={settings} onSettings={changeSettings} onSignal={signal} />
    <footer><span>Manual navigation sandbox</span><span>Sigma reasoning: not connected</span></footer>
    {outside && <p className="notice" role="status">A vessel has left the initial scenario area. Use Follow vessel or reset the encounter.</p>}
    {error && <p className="notice" role="alert">Vessel.js could not initialize: {error}</p>}
  </main>;
}
