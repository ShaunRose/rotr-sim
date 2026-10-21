"use client";

import { rangeText, yardsText, bearingText, tcpaText } from "./units.mjs";
import { logColor } from "./sensor-colors";
import { useEffect, useRef, useState } from "react";
import { labels, type Settings, type ShipId, type LogEntry, type Watch } from "./watchkeeping.mjs";
import type { createSimulation } from "./watchkeeping.mjs";

type Simulation = ReturnType<typeof createSimulation>;
type HelmCommand = { speed: number; rudder: number };
type Props = { state: Simulation; ownCommand: HelmCommand; settings: Settings; onSettings: (settings: Settings) => void; onSignal: (ship: ShipId, kind: "horn" | "vhf") => void };
const ids: ShipId[] = ["own", "target"];
const deviceNames = { visual: "Visual lookout", radar: "Radar / ARPA", ais: "AIS TX / RX", hearing: "Hearing", vhf: "VHF radio" };

function stamp(time: number) {
  const millis = Math.round(time * 1000);
  const seconds = Math.floor(millis / 1000);
  return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor(seconds / 60 % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}.${(millis % 1000).toString().padStart(3, "0")}`;
}
function WatchColumn({ watch, vessel, command, time, settings, onSettings, onSignal, paused }: { watch: Watch; vessel: Simulation["own"]; command: HelmCommand; time: number; settings: Settings; onSettings: Props["onSettings"]; onSignal: Props["onSignal"]; paused: boolean }) {
  const [filter, setFilter] = useState("all");
  const [following, setFollowing] = useState(true);
  const terminal = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (following && terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [watch.logs, filter, following]);
  const id = watch.id;
  const freshTrack = watch.track && time - watch.track.time <= 6 ? watch.track : null;
  const entries = watch.logs.filter(entry => filter === "all" || entry.kind === filter);
  const heading = bearingText(vessel.heading);
  const rudderText = (angle: number) => angle === 0 ? "0° / amidships" : `${Math.abs(angle)}° ${angle < 0 ? "port" : "starboard"}`;
  return <article className={`watch-column watch-${id}`} aria-label={`${labels[id]} watchkeeping`}>
    <header className="watch-header"><div><p className="eyebrow">SHIP {id === "own" ? "01" : "02"} / INDEPENDENT WATCH</p><h3>{id === "own" ? "Own vessel" : "Target vessel"}</h3></div><span className="tag">SENSORS</span></header>
    <section className="vessel-statistics" aria-label={`${id === "own" ? "Own vessel" : "Target vessel"} statistics`}>
      <div className="vessel-stats-heading"><h4>Vessel statistics</h4><span>SIMULATION STATE</span></div>
      <dl className="vessel-stats-grid">
        <div><dt>Current speed</dt><dd>{vessel.speed.toFixed(1)} <small>kt</small></dd></div>
        <div><dt>Target speed</dt><dd>{command.speed.toFixed(1)} <small>kt</small></dd></div>
        <div><dt>Heading</dt><dd>{heading}</dd></div>
        <div><dt>Rudder angle</dt><dd>{rudderText(vessel.rudder)}</dd></div>
        <div><dt>Rudder target</dt><dd>{rudderText(command.rudder)}</dd></div>
        <div><dt>Controller</dt><dd>{id === "own" ? "Manual helm" : "Fixed scenario"}</dd></div>
        <div><dt>Local east</dt><dd>{yardsText(vessel.x)}</dd></div>
        <div><dt>Local north</dt><dd>{yardsText(vessel.y)}</dd></div>
      </dl>
    </section>
    <div className="sensor-strip"><span className={watch.visual ? "sensor-on" : ""}>Visual: {watch.visual ? "in sight" : "no contact"}</span><span className={freshTrack ? "sensor-on" : ""}>Radar: {!settings.equipment[id].radar ? "off" : freshTrack ? "tracking" : watch.radar ? "acquiring" : "no echo"}</span><span className={watch.ais ? "sensor-on" : ""}>AIS: {watch.ais ? `${Math.max(0, time - watch.ais.sent).toFixed(0)} s old` : settings.equipment[id].ais ? "no report" : "off"}</span></div>
    <div className="watch-metrics"><div><span>Observed bearing</span><strong>{watch.visual || watch.radar ? bearingText((watch.visual || watch.radar)!.bearing) : "Unknown"}</strong></div><div><span>Estimated CPA / TCPA</span><strong>{freshTrack ? `${rangeText(freshTrack.dcpa)} / ${tcpaText(freshTrack.tcpa)}` : "Acquiring / unknown"}</strong></div></div>
    <details className="equipment"><summary>Equipment and test signals</summary><div className="equipment-grid">{(Object.keys(deviceNames) as (keyof Settings["equipment"]["own"])[]).map(device => <label key={device}><input type="checkbox" checked={settings.equipment[id][device]} disabled={paused} onChange={e => onSettings({ ...settings, equipment: { ...settings.equipment, [id]: { ...settings.equipment[id], [device]: e.target.checked } } })} />{deviceNames[device]}</label>)}</div><div className="signal-actions"><button disabled={paused} onClick={() => onSignal(id, "horn")}>Sound test horn</button><button disabled={paused || !settings.equipment[id].vhf} onClick={() => onSignal(id, "vhf")}>VHF: request intentions</button></div><p className="note">Test events are simulated messages. No real radio or audio transmission. Run the simulation to deliver pending signals.</p></details>
    <div className="log-toolbar"><h4><span className="terminal-user">bridge@ship-{id === "own" ? "01" : "02"}</span><span className="terminal-path">:~/watchkeeping</span></h4><div className="terminal-tools"><button aria-pressed={following} onClick={() => setFollowing(!following)} aria-label={`Follow ${id === "own" ? "own vessel" : "target vessel"} logs`}>{following ? "Follow: on" : "Follow: off"}</button><label><span className="sr-only">Filter {id === "own" ? "own vessel" : "target vessel"} logs</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All events</option><option value="sensor">Detections</option><option value="control">Controls / signals</option><option value="system">System</option></select></label></div></div>
    <div className="terminal-command" aria-hidden="true"><span><b>$</b> tail -f /var/log/rotr/ship-{id === "own" ? "01" : "02"}.log</span><small>SIM CLOCK</small></div>
    <ol className="watch-log" ref={terminal} aria-label={`${labels[id]} event log`} tabIndex={0} onScroll={e => { const el = e.currentTarget; setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24); }}>{entries.map((entry: LogEntry, i: number) => <li key={`${entry.time}-${entry.source}-${i}`} className={`log-${entry.kind}`}><time>[{stamp(entry.time)}]</time><span className="terminal-line"><span className="terminal-kind">[{entry.kind.toUpperCase()}]</span>{" "}<span style={{ color: logColor(entry.source) }} className="terminal-source">[{entry.source.replaceAll(" / ", "/")}]</span>{" "}<span className="terminal-message">{entry.message}</span></span></li>)}</ol>
    <div className="log-retention"><span>{watch.logs.length} events / last 300 retained</span><span>elapsed simulation time / {following ? "following output" : "scroll paused"}</span></div>  </article>;
}

export default function Watchkeeping({ state, ownCommand, settings, onSettings, onSignal }: Props) {
  const download = () => {
    const blob = new Blob([JSON.stringify({ version: 3, units: { settingsVisibility: "m", simulationTime: "s", logDisplay: "US Navy navigation: kt, NM/yd, degrees true, TCPA minutes" }, simulationTime: state.time, settings, reasoningLanguage: "SUO-KIF", sigmaConnected: false, own: state.bridge.own.logs, target: state.bridge.target.logs }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `rotr-watchkeeping-${Math.floor(state.time)}s.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="watchkeeping" aria-label="Per-ship sensor observations">
    <header className="watchkeeping-heading"><div><p className="eyebrow">VESSEL WATCHKEEPING / SENSOR LOGS</p></div><button onClick={download}>Export logs</button></header>
    <div className="watch-columns">{ids.map(id => <WatchColumn key={id} watch={state.bridge[id]} vessel={state[id]} command={id === "own" ? ownCommand : { speed: state.target.speed, rudder: 0 }} time={state.time} settings={settings} onSettings={onSettings} onSignal={onSignal} paused={!!state.collision} />)}</div>
  </section>;
}
