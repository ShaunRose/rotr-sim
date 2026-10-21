import { KNOT } from "./model.mjs";

/** @typedef {import('./watchkeeping.mjs').Watch} Watch */
/** @typedef {import('./watchkeeping.mjs').Settings} Settings */
/** @typedef {import('./watchkeeping.mjs').ShipId} ShipId */
/** @typedef {"observer" | ShipId} SensorView */
/** @typedef {{ visual: boolean, radar: boolean, arpa: boolean, ais: boolean, sound: boolean, vhf: boolean }} OverlayToggles */
export const defaultOverlays = { visual: true, radar: true, arpa: false, ais: false, sound: true, vhf: false };
const ids = /** @type {ShipId[]} */ (["own", "target"]);
const point = (x, y) => ({ x, y });
const worldPoint = detection => point(detection.originX + detection.x, detection.originY + detection.y);

/** Project only this receiver's observations into display geometry. No other-ship truth is read. @param {Watch} watch @param {Settings} settings @param {number} time @param {OverlayToggles} enabled */
export function sensorFrame(watch, settings, time, enabled = defaultOverlays) {
  const equipment = settings.equipment[watch.id];
  const nav = watch.nav;
  const visual = equipment.visual && watch.visual && time - watch.visual.time <= 6 ? watch.visual : null;
  const radar = equipment.radar && watch.radar && time - watch.radar.time <= 6 ? watch.radar : null;
  const track = radar && watch.track && time - watch.track.time <= 6 ? watch.track : null;
  const ais = equipment.ais && watch.ais && time - watch.ais.sent <= 15 ? watch.ais : null;
  const hearing = equipment.hearing ? watch.receivedSignals.filter(signal => signal.kind === "horn" && time - signal.time <= 4) : [];
  const vhf = equipment.vhf ? watch.receivedSignals.filter(signal => signal.kind === "vhf" && time - signal.time <= 8) : [];
  const visualPoint = visual ? worldPoint(visual) : null;
  const radarPoint = radar ? worldPoint(radar) : null;
  const knownTarget = visualPoint || radarPoint || (ais ? point(ais.x, ais.y) : null);
  let prediction = null;
  if (enabled.arpa && track && radar && nav && radarPoint) {
    const angle = track.course * Math.PI / 180;
    const velocity = point(Math.sin(angle) * track.speed * KNOT, Math.cos(angle) * track.speed * KNOT);
    const ownAngle = nav.heading * Math.PI / 180;
    const ownVelocity = point(Math.sin(ownAngle) * nav.speed * KNOT, Math.cos(ownAngle) * nav.speed * KNOT);
    const cpaVisible = track.closing && track.tcpa <= 180;
    prediction = { point: radarPoint, vectorEnd: point(radarPoint.x + velocity.x * 60, radarPoint.y + velocity.y * 60),
      ownCpa: cpaVisible ? point(radar.originX + ownVelocity.x * track.tcpa, radar.originY + ownVelocity.y * track.tcpa) : null,
      targetCpa: cpaVisible ? point(radarPoint.x + velocity.x * track.tcpa, radarPoint.y + velocity.y * track.tcpa) : null,
      tcpa: track.tcpa, dcpa: track.dcpa };
  }
  return {
    id: watch.id, origin: nav ? point(nav.x, nav.y) : null, heading: nav?.heading ?? 0,
    visibility: enabled.visual && equipment.visual ? settings.visibility : null,
    radarEnabled: enabled.radar && equipment.radar,
    visual: enabled.visual && visual && visualPoint ? { point: visualPoint, origin: point(visual.originX, visual.originY), age: time - visual.time, aspect: settings.night ? visual.aspect : "visual contact" } : null,
    radar: enabled.radar && radar && radarPoint ? { point: radarPoint, age: time - radar.time, errorRadius: 2 + radar.range * Math.tan(0.15 * Math.PI / 180) } : null,
    prediction,
    ais: enabled.ais && ais ? { point: point(ais.x, ais.y), heading: ais.heading, age: time - ais.sent, opacity: Math.max(0.2, 1 - (time - ais.sent) / 18) } : null,
    hearing: enabled.sound ? hearing : [], vhf: enabled.vhf ? vhf : [], knownTarget,
  };
}

/** Observer mode includes truth hulls; receiver mode draws only its own hull and received markers. @param {ReturnType<import('./watchkeeping.mjs').createSimulation>} state @param {SensorView} view @param {OverlayToggles} enabled */
export function sensorPresentation(state, view = "observer", enabled = defaultOverlays) {
  const selected = view === "observer" ? ids : [view];
  return {
    physicalShips: view === "observer" ? ids : [view],
    frames: selected.map(id => sensorFrame(state.bridge[id], state.bridge.settings, state.time, enabled)),
    emissions: view === "observer" ? state.bridge.emissions.filter(signal => (signal.kind === "horn" ? state.time <= signal.delivery : state.time - signal.sent <= 6) && (signal.kind === "horn" ? enabled.sound : enabled.vhf)) : [],
  };
}
