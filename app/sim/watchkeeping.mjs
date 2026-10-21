import { rangeText, yardsText, bearingText, tcpaText } from "./units.mjs";
import { advance, initialState, KNOT } from "./model.mjs";

/** @typedef {"own" | "target"} ShipId */
/** @typedef {{ visual: boolean, radar: boolean, ais: boolean, hearing: boolean, vhf: boolean }} Equipment */
/** @typedef {{ visibility: number, restricted: boolean, night: boolean, equipment: Record<ShipId, Equipment> }} Settings */
/** @typedef {{ time: number, source: string, message: string, kind: "sensor" | "control" | "system" }} LogEntry */
/** @typedef {{ time: number, x: number, y: number, heading: number, speed: number }} Navigation */
/** @typedef {{ time: number, range: number, bearing: number, relative: number, originX: number, originY: number, x: number, y: number, aspect: string }} Detection */
/** @typedef {{ time: number, dcpa: number, tcpa: number, closing: boolean, course: number, speed: number }} Track */
/** @typedef {{ sent: number, delivery: number, id: ShipId, x: number, y: number, heading: number, speed: number }} AisPacket */
/** @typedef {{ time: number, kind: "horn" | "vhf", bearing: number | null, from: ShipId | null, message: string }} ReceivedSignal */
/** @typedef {{ id: ShipId, receivedSignals: ReceivedSignal[], logs: LogEntry[], nav: Navigation | null, visual: Detection | null, visualSamples: Detection[], radar: Detection | null, samples: Detection[], track: Track | null, ais: AisPacket | null, pendingAis: AisPacket[], last: Record<string, number>, control: string, collisionLogged: boolean }} Watch */
/** @typedef {{ from: ShipId, to: ShipId, kind: "horn" | "vhf", sent: number, originX: number, originY: number, delivery: number, bearing: number }} Signal */
/** @typedef {{ own: Watch, target: Watch, settings: Settings, signals: Signal[], emissions: Signal[] }} Bridge */

export const LOG_LIMIT = 300;
export const labels = { own: "01 / Own vessel", target: "02 / Target vessel" };
const ids = /** @type {ShipId[]} */ (["own", "target"]);
const wrap = angle => ((angle + 540) % 360) - 180;
const bearing = (x, y) => (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
const noise = (time, seed) => Math.sin(time * 0.73 + seed);

/** Default training conditions; each device can be disabled independently. */
export function defaultSettings() {
  const equipment = () => ({ visual: true, radar: true, ais: true, hearing: true, vhf: true });
  return { visibility: 2000, restricted: false, night: false, equipment: { own: equipment(), target: equipment() } };
}

/** @param {Watch} watch @param {number} time @param {string} source @param {string} message @param {LogEntry["kind"]} kind */
function log(watch, time, source, message, kind = "sensor") {
  watch.logs.push({ time, source, message, kind });
  if (watch.logs.length > LOG_LIMIT) watch.logs.splice(0, watch.logs.length - LOG_LIMIT);
}

/** @param {ShipId} id @returns {Watch} */
function emptyWatch(id) {
  return { id, receivedSignals: [], logs: [], nav: null, visual: null, visualSamples: [], radar: null, samples: [], track: null, ais: null,
    pendingAis: [],
    last: { nav: -Infinity, visual: -Infinity, radar: -Infinity, ais: -Infinity }, control: "", collisionLogged: false };
}

/** Sample a bounded-error range and compass bearing; this is the sensor/world boundary. */
function measurement(observer, target, time, seed, visual) {
  const dx = target.x - observer.x, dy = target.y - observer.y;
  const range = Math.max(0, Math.hypot(dx, dy) + noise(time, seed) * (visual ? 15 : 2));
  const compass = (bearing(dx, dy) + noise(time, seed + 1) * (visual ? 0.4 : 0.15) + 360) % 360;
  const angle = compass * Math.PI / 180;
  const aspect = wrap(bearing(-dx, -dy) - target.heading);
  const lights = Math.abs(aspect) > 112.5 ? "white sternlight" : Math.abs(aspect) <= 2
    ? "masthead white + red and green sidelights" : `masthead white + ${aspect > 0 ? "green starboard" : "red port"} sidelight`;
  return { time, range, bearing: compass, relative: wrap(compass - observer.heading),
    originX: observer.x, originY: observer.y, x: range * Math.sin(angle), y: range * Math.cos(angle), aspect: lights };
}

/** Estimate motion from a radar history and own instruments, never target truth. @param {Watch} watch */
function radarTrack(watch) {
  if (watch.samples.length < 3 || !watch.nav) return null;
  const first = watch.samples[0], last = watch.samples[watch.samples.length - 1];
  const dt = last.time - first.time;
  if (dt < 3.9) return null;
  const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
  const vv = vx * vx + vy * vy;
  const future = vv < 1e-6 ? 0 : -(last.x * vx + last.y * vy) / vv;
  const tcpa = Math.max(0, future);
  const h = watch.nav.heading * Math.PI / 180;
  const tx = vx + Math.sin(h) * watch.nav.speed * KNOT;
  const ty = vy + Math.cos(h) * watch.nav.speed * KNOT;
  return { time: last.time, dcpa: Math.hypot(last.x + vx * tcpa, last.y + vy * tcpa), tcpa,
    closing: future > 0, course: bearing(tx, ty), speed: Math.hypot(tx, ty) / KNOT };
}

/** Update independent receiver histories at simulated device intervals. @param {ReturnType<typeof initialState>} state @param {Bridge} old @param {Settings} settings */
export function observe(state, old, settings, command) {
  const time = state.time;
  const bridge = { ...old, settings: structuredClone(settings), signals: old.signals.filter(signal => signal.delivery > time), emissions: old.emissions.filter(signal => signal.kind === "horn" ? time <= signal.delivery : time - signal.sent <= 6) };
  for (const id of ids) {
    const other = id === "own" ? "target" : "own";
    const previous = old[id];
    const watch = { ...previous, logs: [...previous.logs], receivedSignals: [...previous.receivedSignals], samples: [...previous.samples], visualSamples: [...previous.visualSamples], pendingAis: [...previous.pendingAis], last: { ...previous.last } };
    bridge[id] = watch;
    const equipment = settings.equipment[id];
    const changed = JSON.stringify(settings) !== JSON.stringify(old.settings);
    if (changed) log(watch, time, "CONFIG", `Visibility ${rangeText(settings.visibility)}; ${settings.night ? "night" : "day"}; active: ${Object.entries(equipment).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}.`, "system");
    const own = state[id], target = state[other], seed = id === "own" ? 0.3 : 2.1;
    if (time - watch.last.nav >= 1 - 1e-6) {
      watch.nav = { time, x: own.x + noise(time, seed) * 0.5, y: own.y + noise(time, seed + 2) * 0.5, heading: own.heading, speed: own.speed };
      if (time - (watch.last.navLog ?? -Infinity) >= 10 - 1e-6) {
        log(watch, time, "GNSS / GYRO / LOG", `Local position E ${yardsText(watch.nav.x)} / N ${yardsText(watch.nav.y)}; heading ${bearingText(own.heading)}; speed ${own.speed.toFixed(1)} kt. No current in this scenario.`);
        watch.last.navLog = time;
      }
      watch.last.nav = time;
    }
    if (changed || time - watch.last.visual >= 5 - 1e-6) {
      const seen = equipment.visual && Math.hypot(target.x - own.x, target.y - own.y) <= settings.visibility;
      if (seen) {
        watch.visual = measurement(own, target, time, seed, true);
        watch.visualSamples = [...watch.visualSamples.filter(sample => sample.time < time - 1e-6).slice(-2), watch.visual];
        const first = watch.visualSamples[0];
        const interval = time - first.time;
        const change = Math.abs(wrap(watch.visual.bearing - first.bearing));
        if (interval >= 9.9 && time - (watch.last.bearingLog ?? -Infinity) >= 10 - 1e-6) {
          log(watch, time, "BEARING TREND", `True bearing changed ${change.toFixed(1)}° over ${interval.toFixed(0)} s; approximate range changed ${yardsText(watch.visual.range - first.range)}.`);
          watch.last.bearingLog = time;
        }
        log(watch, time, "LOOKOUT", `Vessel in sight: true bearing ${bearingText(watch.visual.bearing)}, ${Math.abs(watch.visual.relative).toFixed(0)}° ${watch.visual.relative >= 0 ? "starboard" : "port"}; approximate range ${rangeText(watch.visual.range)}. ${settings.night ? `Observed ${watch.visual.aspect}.` : "Power-driven vessel recognized (training assumption)."}`);
      } else if (watch.visual || watch.last.visual === -Infinity || changed) log(watch, time, "LOOKOUT", equipment.visual ? `No visual contact within ${rangeText(settings.visibility)} visibility. Traffic may still be present.` : "Visual lookout disabled; no visual observations available.");
      watch.visual = seen ? watch.visual : null;
      if (!seen) { watch.visualSamples = []; }
      watch.last.visual = time;
    }
    if (!equipment.radar) {
      if (watch.radar || watch.last.radar === -Infinity) log(watch, time, "RADAR", "Radar disabled; no radar observations or ARPA motion estimate.");
      watch.radar = null; watch.track = null; watch.samples = [];
      watch.last.radar = time;
    } else if (changed || time - watch.last.radar >= 2 - 1e-6) {
      if (Math.hypot(target.x - own.x, target.y - own.y) <= 6000) {
        const detection = measurement(own, target, time, seed + 3, false);
        watch.radar = detection;
        watch.samples = [...watch.samples.filter(sample => sample.time < time - 1e-6).slice(-5), detection];
        watch.track = radarTrack(watch);
        log(watch, time, "RADAR", `Echo: ${rangeText(detection.range)} at true bearing ${bearingText(detection.bearing)}. Simulated errors bounded by ${yardsText(2)} / 0.15°.`);
        if (watch.track && time - (watch.last.arpa ?? -Infinity) >= 6 - 1e-6) {
          log(watch, time, "ARPA", `From ${watch.samples.length} scans: estimated course ${bearingText(watch.track.course)} / ${watch.track.speed.toFixed(1)} kt; CPA ${rangeText(watch.track.dcpa)}; TCPA ${tcpaText(watch.track.tcpa)}. Acquisition accelerated for this short scenario.`);
          watch.last.arpa = time;
        }
      } else { watch.radar = null; watch.track = null; watch.samples = []; }
      watch.last.radar = time;
    }
    if (equipment.ais && settings.equipment[other].ais && time - watch.last.ais >= 5 - 1e-6) {
      if (Math.hypot(target.x - own.x, target.y - own.y) <= 10000) watch.pendingAis.push({ sent: time, delivery: time + 2, id: other, x: target.x, y: target.y, heading: target.heading, speed: target.speed });
      watch.last.ais = time;
    }
    const delivered = watch.pendingAis.filter(packet => packet.delivery <= time + 1e-6);
    watch.pendingAis = watch.pendingAis.filter(packet => packet.delivery > time + 1e-6);
    if (!equipment.ais) { watch.ais = null; watch.pendingAis = []; }
    else if (delivered.length) {
      watch.ais = delivered[delivered.length - 1];
      log(watch, time, "AIS", `${labels[watch.ais.id]} reports local position E ${yardsText(watch.ais.x)} / N ${yardsText(watch.ais.y)}, COG/heading ${bearingText(watch.ais.heading)}, SOG ${watch.ais.speed.toFixed(1)} kt; status underway. Message age ${(time - watch.ais.sent).toFixed(1)} s; unverified report, not visual contact.`);
    }
    if (watch.ais && time - watch.ais.sent > 15) { log(watch, time, "AIS", "Last AIS report expired; identity/motion data unavailable."); watch.ais = null; }
    for (const signal of old.signals.filter(signal => signal.to === id && signal.delivery <= time)) {
      if (signal.kind === "horn" && equipment.hearing) {
        watch.receivedSignals.push({ time, kind: "horn", bearing: signal.bearing, from: null, message: "Horn heard; range unknown" });
        log(watch, time, "HEARING", `Horn heard near true bearing ${bearingText(signal.bearing)} (approximate). No range or maneuver intent inferred from this unclassified test signal.`);
      }
      if (signal.kind === "vhf" && equipment.vhf) {
        watch.receivedSignals.push({ time, kind: "vhf", bearing: null, from: signal.from, message: "Please state your intentions." });
        log(watch, time, "VHF", `${labels[signal.from]} asks: "Please state your intentions." No maneuver agreement or automatic reply inferred.`);
      }
    }
    watch.receivedSignals = watch.receivedSignals.slice(-20);
    const control = id === "own" ? `Manual helm target: ${command.speed.toFixed(1)} kt, rudder ${command.rudder}°.` : "Scenario controller holds 270.0°T at 20 kt.";
    if (control !== watch.control) { log(watch, time, "CONTROL", control, "control"); watch.control = control; }
    if (state.collision && !watch.collisionLogged) {
      log(watch, time, "EVALUATOR", "Ground-truth hull contact detected. Simulation clock and controls paused; reset required.", "system");
      watch.collisionLogged = true;
    }
  }
  return bridge;
}

/** Create both watches and initial observations alongside the existing navigation model. */
export function createSimulation(settings = defaultSettings()) {
  const state = initialState();
  const bridge = { own: emptyWatch("own"), target: emptyWatch("target"), settings: structuredClone(settings), signals: /** @type {Signal[]} */ ([]), emissions: /** @type {Signal[]} */ ([]) };
  return { ...state, bridge: observe(state, bridge, settings, { speed: 20, rudder: 0 }) };
}

/** Keep sensor clocks on simulation time, including collision pause. */
export function advanceSimulation(state, command, dt, settings) {
  if (state.collision) return state;
  const next = advance(state, command, dt);
  return { ...next, bridge: observe(next, state.bridge, settings, command) };
}

/** Emit an optional synthetic sound or radio message; delivery depends on the receiving equipment. @param {ReturnType<typeof createSimulation>} state @param {Settings} settings @param {ShipId} from @param {"horn" | "vhf"} kind */
export function emitSignal(state, settings, from, kind) {
  const to = from === "own" ? "target" : "own";
  const range = Math.hypot(state[to].x - state[from].x, state[to].y - state[from].y);
  const bridge = { ...state.bridge, signals: [...state.bridge.signals], emissions: [...state.bridge.emissions] };
  const sender = { ...bridge[from], logs: [...bridge[from].logs] };
  bridge[from] = sender;
  if (kind === "vhf" && !settings.equipment[from].vhf) return state;
  log(sender, state.time, kind === "horn" ? "HORN TX" : "VHF TX", kind === "horn" ? "Unclassified test horn sounded; reception is not guaranteed." : 'Broadcast: "Please state your intentions." Reception or agreement is not guaranteed.', "control");
  const event = { from, to, kind, sent: state.time, originX: state[from].x, originY: state[from].y,
    delivery: state.time + (kind === "horn" ? range / 343 : 1),
    bearing: (bearing(state[from].x - state[to].x, state[from].y - state[to].y) + 10 * noise(state.time, 1) + 360) % 360 };
  bridge.emissions = [...bridge.emissions.slice(-19), event];
  if (range <= (kind === "horn" ? 6000 : 10000)) bridge.signals.push(event);
  return { ...state, bridge };
}
