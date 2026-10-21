import { rangeText, bearingText, tcpaText } from "./units.mjs";
import { sensorColors } from "./sensor-colors";
import * as THREE from "three";
import { sensorPresentation } from "./sensor-view.mjs";

type Presentation = ReturnType<typeof sensorPresentation>;
type Frame = Presentation["frames"][number];
type Point = { x: number; y: number };
const world = (p: Point, height = 5) => new THREE.Vector3(p.x - 600, height, 400 - p.y);

function line(color: THREE.ColorRepresentation, dashed = false) {
  const material = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 7, gapSize: 5, transparent: true, opacity: 0.75 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(18), 3));
  geometry.setDrawRange(0, 0);
  const result = new THREE.Line(geometry, material);
  result.frustumCulled = false;
  return result;
}

function setLine(object: THREE.Line, points: Point[], height = 5) {
  const positions = object.geometry.getAttribute("position");
  points.forEach((point, i) => { const p = world(point, height); positions.setXYZ(i, p.x, p.y, p.z); });
  positions.needsUpdate = true;
  object.geometry.setDrawRange(0, points.length);
  if (object.material instanceof THREE.LineDashedMaterial) object.computeLineDistances();
}

function circle(color: THREE.ColorRepresentation, radius = 1, opacity = 0.4) {
  const points = Array.from({ length: 96 }, (_, i) => {
    const angle = i / 96 * Math.PI * 2;
    return new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
  });
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function label(color: THREE.ColorRepresentation, offset: number) {
  const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 80;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, sizeAttenuation: false }));
  sprite.scale.set(0.17, 0.024, 1); sprite.center.set(0.5, -offset);
  sprite.frustumCulled = false;
  let last = "";
  return { sprite, text(message: string, tint: THREE.ColorRepresentation = color) {
    const cacheKey = `${message}/${tint}`;
    if (!context || last === cacheKey) return;
    last = cacheKey;
    context.clearRect(0, 0, 768, 80);
    context.fillStyle = "rgba(5, 19, 28, .88)"; context.fillRect(0, 0, 768, 80);
    context.fillStyle = `#${new THREE.Color(tint).getHexString()}`;
    context.font = "42px monospace"; context.fillText(message, 12, 49, 744);
    texture.needsUpdate = true;
  } };
}

function receiverObjects(id: string) {
  const root = new THREE.Group();
  const boundary = circle(sensorColors.visual, 1, 0.25);
  const radarRings = [250, 500].map(radius => circle(sensorColors.radar, radius, 0.22));
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(500, 32, 0, 0.24), new THREE.MeshBasicMaterial({ color: sensorColors.radar, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  sweep.rotation.x = -Math.PI / 2;
  const visualLine = line(sensorColors.visual);
  const visualMarker = circle(sensorColors.visual, 9, 0.9);
  const echo = circle(sensorColors.radar, 6, 0.95);
  const uncertainty = circle(sensorColors.radar, 1, 0.35);
  const velocity = line(sensorColors.arpa, true), ownCpa = line(sensorColors.arpa, true), targetCpa = line(sensorColors.arpa, true), gap = line(sensorColors.arpa, true);
  const cpaMarker = circle(sensorColors.arpa, 6, 0.8);
  const ais = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -9), new THREE.Vector3(6, 0, 6), new THREE.Vector3(-6, 0, 6)]), new THREE.LineBasicMaterial({ color: sensorColors.ais, transparent: true, opacity: 0.9 }));
  const hearing = new THREE.Group();
  const sector = new THREE.Mesh(new THREE.CircleGeometry(120, 32, Math.PI / 2 - 0.21, 0.42), new THREE.MeshBasicMaterial({ color: sensorColors.sound, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
  sector.rotation.x = -Math.PI / 2; hearing.add(sector);
  const labels = { visual: label(sensorColors.visual, 0), radar: label(sensorColors.radar, 1.25), ais: label(sensorColors.ais, 2.5), cpa: label(sensorColors.arpa, 0), sound: label(sensorColors.sound, 1), vhf: label(sensorColors.vhf, 3.75) };
  root.add(boundary, ...radarRings, sweep, visualLine, visualMarker, echo, uncertainty, velocity, ownCpa, targetCpa, gap, cpaMarker, ais, hearing, ...Object.values(labels).map(item => item.sprite));
  const prefix = id === "own" ? "01" : "02";
  const showLabel = (name: keyof typeof labels, visible: boolean, point: Point, text: string, opacity = 1) => {
    const item = labels[name]; item.sprite.visible = visible;
    if (visible) { item.sprite.position.copy(world(point, 7)); item.sprite.material.opacity = opacity; item.text(text); }
  };
  return { root, update(frame: Frame, time: number) {
    const origin = frame.origin;
    root.visible = !!origin;
    if (!origin) return;
    boundary.visible = frame.visibility !== null;
    if (frame.visibility !== null) { boundary.position.copy(world(origin, 3)); boundary.scale.setScalar(frame.visibility); }
    radarRings.forEach(ring => { ring.visible = frame.radarEnabled; ring.position.copy(world(origin, 4)); });
    sweep.visible = frame.radarEnabled; sweep.position.copy(world(origin, 3)); sweep.rotation.z = -time * Math.PI;
    visualLine.visible = visualMarker.visible = !!frame.visual;
    if (frame.visual) { setLine(visualLine, [frame.visual.origin, frame.visual.point], 6); visualMarker.position.copy(world(frame.visual.point, 6)); }
    showLabel("visual", !!frame.visual, frame.visual?.point ?? origin, `${prefix} LOOKOUT · ${frame.visual?.aspect === "visual contact" ? "contact" : frame.visual?.aspect.replace("masthead white + ", "WH + ").replace(" sidelight", "") ?? ""}`);
    echo.visible = uncertainty.visible = !!frame.radar;
    if (frame.radar) {
      echo.position.copy(world(frame.radar.point, 6)); echo.material.opacity = Math.max(0.2, 1 - frame.radar.age / 6);
      uncertainty.position.copy(world(frame.radar.point, 6)); uncertainty.scale.setScalar(frame.radar.errorRadius);
    }
    showLabel("radar", !!frame.radar, frame.radar?.point ?? origin, `${prefix} RADAR · ${frame.radar?.age.toFixed(1)}s`);
    ais.visible = !!frame.ais;
    if (frame.ais) { ais.position.copy(world(frame.ais.point, 6)); ais.rotation.y = -frame.ais.heading * Math.PI / 180; ais.material.opacity = frame.ais.opacity; }
    showLabel("ais", !!frame.ais, frame.ais?.point ?? origin, `${prefix} AIS · ${frame.ais?.age.toFixed(1)}s old`, frame.ais?.opacity ?? 1);
    const prediction = frame.prediction;
    velocity.visible = !!prediction;
    if (prediction) setLine(velocity, [prediction.point, prediction.vectorEnd], 8);
    const hasCpa = !!prediction?.ownCpa && !!prediction.targetCpa;
    ownCpa.visible = targetCpa.visible = gap.visible = cpaMarker.visible = hasCpa;
    if (prediction?.ownCpa && prediction.targetCpa) {
      setLine(ownCpa, [origin, prediction.ownCpa], 8);
      setLine(targetCpa, [prediction.point, prediction.targetCpa], 8);
      setLine(gap, [prediction.ownCpa, prediction.targetCpa], 8);
      cpaMarker.position.copy(world(prediction.targetCpa, 8));
    }
    showLabel("cpa", hasCpa, prediction?.targetCpa ?? origin, `${prefix} EST CPA ${prediction ? rangeText(prediction.dcpa) : "—"} / ${prediction ? tcpaText(prediction.tcpa) : "—"}`);
    const heard = frame.hearing.at(-1);
    hearing.visible = !!heard;
    if (heard) { hearing.position.copy(world(origin, 6)); hearing.rotation.y = -(heard.bearing ?? 0) * Math.PI / 180; }
    showLabel("sound", !!heard, origin, `${prefix} HORN ~${heard?.bearing != null ? bearingText(heard.bearing) : "—"} / range unknown`);
    const message = frame.vhf.at(-1);
    showLabel("vhf", !!message, origin, `${prefix} VHF RX: request intentions`);
  } };
}

/** Sensor HUD pass: separate from physical rendering so overlays do not reflect in the water. */
export function createSensorOverlays() {
  const scene = new THREE.Scene();
  const receivers = { own: receiverObjects("own"), target: receiverObjects("target") };
  scene.add(receivers.own.root, receivers.target.root);
  const emissions = Array.from({ length: 20 }, () => {
    const root = new THREE.Group();
    const ring = circle(0xffffff, 1, 0.6);
    const text = label(0xffffff, 1);
    root.add(ring, text.sprite); scene.add(root);
    return { root, ring, text };
  });
  return { scene, update(presentation: Presentation, time: number) {
    receivers.own.root.visible = receivers.target.root.visible = false;
    presentation.frames.forEach(frame => receivers[frame.id].update(frame, time));
    emissions.forEach((item, i) => {
      const signal = presentation.emissions[i]; item.root.visible = !!signal;
      if (!signal) return;
      const age = Math.max(0, time - signal.sent);
      item.root.position.copy(world({ x: signal.originX, y: signal.originY }, 5));
      item.ring.scale.setScalar(signal.kind === "horn" ? Math.max(1, age * 343) : 12 + age * 8);
      item.ring.material.opacity = Math.max(0, 0.7 * (1 - age / 6));
      const color = signal.kind === "horn" ? sensorColors.sound : sensorColors.vhf;
      item.ring.material.color.set(color);
      item.text.sprite.position.set(0, 5, 0);
      item.text.text(`${signal.from === "own" ? "01" : "02"} ${signal.kind === "horn" ? "HORN EMISSION" : "VHF TX"}`, color);
    });
  }, dispose() {
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
        if ("geometry" in object) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
          material.dispose();
        });
      }
    });
  } };
}
