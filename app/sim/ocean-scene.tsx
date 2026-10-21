"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Water } from "three/addons/objects/Water.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Sky } from "three/addons/objects/Sky.js";
import { rangeText } from "./units.mjs";
import { sensorColors } from "./sensor-colors";
import { closedHull } from "./naval-hull.mjs";
import { hull, WORLD } from "./model.mjs";
import { createSimulation, type Settings, type ShipId } from "./watchkeeping.mjs";
import { sensorPresentation, defaultOverlays, type SensorView, type OverlayToggles } from "./sensor-view.mjs";
import { createSensorOverlays } from "./sensor-overlays";

type State = ReturnType<typeof createSimulation>;
type CameraMode = "follow" | "encounter" | "overhead";

/** A regular swell, shared by the ocean shader and the boat surface sampling. */
function surface(x: number, z: number, time: number, amplitude: number) {
  return amplitude * (Math.sin(x * 0.065 + z * 0.025 - time * 0.9)
    + 0.35 * Math.sin(x * -0.038 + z * 0.08 - time * 1.15));
}

function normalTexture() {
  const size = 128;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const dx = Math.cos(u * 8 + v * 3) * 0.24 + Math.sin(u * 13 - v * 7) * 0.15;
    const dz = Math.cos(v * 9 - u * 4) * 0.24 + Math.sin(v * 17 + u * 5) * 0.15;
    const n = new THREE.Vector3(dx, dz, 1).normalize();
    const index = (y * size + x) * 4;
    bytes[index] = (n.x + 1) * 127.5;
    bytes[index + 1] = (n.y + 1) * 127.5;
    bytes[index + 2] = (n.z + 1) * 127.5;
    bytes[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Keep a lightweight fallback until the local naval GLB finishes loading. */
function makeBoat(color: number, label: string) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const visual = new THREE.Group();
  body.add(visual);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.12 });
  const red = new THREE.MeshStandardMaterial({ color: 0x792e28, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0efdf, roughness: 0.55 });
  const deck = new THREE.MeshStandardMaterial({ color: 0x47585b, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17292e, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x254d60, roughness: 0.12, metalness: 0.55 });
  const lengthScale = hull.length / 20;
  const heightScale = hull.depth / 4;
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); visual.add(mesh); return mesh;
  };
  const addDetail = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => addBox(w * lengthScale, h * heightScale, d * lengthScale, x * lengthScale, y * heightScale, z * lengthScale, material);
  addBox(hull.beam, hull.draft, hull.length, 0, -hull.draft / 2, 0, red);
  addBox(hull.beam, hull.depth - hull.draft, hull.length, 0, (hull.depth - hull.draft) / 2, 0, paint);
  addDetail(6.08, 0.3, 20.08, 0, 0.22, 0, dark);
  addDetail(5.8, 0.15, 19.8, 0, 2.55, 0, deck);
  addDetail(4.6, 2.5, 6.6, 0, 3.86, -1.8, white);
  addDetail(4.95, 0.2, 7, 0, 5.2, -1.8, white);
  addDetail(3.9, 1.1, 0.06, 0, 4.1, -5.12, glass);
  addDetail(0.06, 1.1, 4.5, -2.32, 4.1, -2, glass);
  addDetail(0.06, 1.1, 4.5, 2.32, 4.1, -2, glass);
  for (const x of [-1.1, 0, 1.1]) addDetail(0.09, 1.2, 0.09, x, 4.1, -5.17, white);
  addDetail(1.4, 2.1, 1.7, 0, 3.65, 3.2, paint);
  addDetail(1.5, 0.4, 1.8, 0, 4.8, 3.2, dark);
  addDetail(0.15, 3.4, 0.15, 0, 6.9, -1.4, white);
  addDetail(3.2, 0.12, 0.2, 0, 8, -1.4, white);
  addDetail(1.7, 0.18, 0.4, 0, 8.65, -1.4, dark);
  for (const side of [-1, 1]) {
    for (let z = -9; z <= 9; z += 3) addDetail(0.08, 0.9, 0.08, side * 2.75, 3.05, z, white);
    addDetail(0.08, 0.08, 18, side * 2.75, 3.5, 0, white);
    for (const z of [-7, 0, 7]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 8, 16), dark);
      tyre.scale.set(lengthScale, heightScale, lengthScale); tyre.rotation.y = Math.PI / 2; tyre.position.set(side * 3.1 * lengthScale, 1.2 * heightScale, z * lengthScale); visual.add(tyre);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x36ff88 : 0xff4433 }));
    lamp.position.set(side * 2.0 * lengthScale, 2.0 * heightScale, -2.0 * lengthScale); body.add(lamp);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.font = "700 40px Arial"; ctx.textAlign = "center";
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(3, 15, 22, .82)";
    ctx.strokeText(label, 256, 59); ctx.fillText(label, 256, 59);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.material.sizeAttenuation = false;
  sprite.position.y = hull.depth + 7; sprite.scale.set(0.13, 0.024, 1); root.add(sprite);
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(7, 38), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main() {
      float spread = mix(0.5, 0.12, vUv.y);
      float edge = 1.0 - smoothstep(spread * 0.5, spread, abs(vUv.x - 0.5));
      float fade = sin(vUv.y * 3.14159);
      float foam = 0.55 + 0.45 * sin(vUv.y * 90.0 + sin(vUv.x * 30.0));
      gl_FragColor = vec4(0.78, 0.94, 0.93, edge * fade * foam * 0.22);
    }`,
  }));
  wake.rotation.x = -Math.PI / 2; wake.scale.set(lengthScale, 1, lengthScale); wake.position.set(0, 0.12, 27 * lengthScale); root.add(wake);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(hull.beam + 0.2, hull.depth + 0.2, hull.length + 0.2)),
    new THREE.LineBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.95 }),
  );
  outline.position.y = hull.depth / 2 - hull.draft;
  outline.visible = false;
  body.add(outline);
  const paints = [paint];
  const installModel = (model: THREE.Group) => {
    visual.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    const oldMaterials = new Set<THREE.Material>();
    visual.traverse(object => {
      if (object instanceof THREE.Mesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => oldMaterials.add(material));
    });
    oldMaterials.forEach(material => material.dispose());
    body.remove(visual);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    // This asset is Y-up with its bow along -Z, matching the simulation.
    model.scale.set(hull.beam / size.x, hull.length / size.z, hull.length / size.z);
    // Extract only the upper open boundary of the two library hull panels.
    // These coordinates are shared with the deck; never stretch that seam.
    const hullNames = new Set(["nurbsToPoly1", "nurbsToPoly107"]);
    const rimPoints = new Map<string, THREE.Vector3>();
    const rimEdges: [string, string][] = [];
    const key = (p: THREE.Vector3) => [p.x, p.y, p.z].map(value => value.toFixed(4)).join(",");
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !hullNames.has(object.name)) return;
      const positions = object.geometry.getAttribute("position");
      const index = object.geometry.index!;
      const edges = new Map<string, { a: number; b: number; count: number }>();
      for (let i = 0; i < index.count; i += 3) for (let side = 0; side < 3; side++) {
        const a = index.getX(i + side), b = index.getX(i + (side + 1) % 3);
        const edgeKey = [Math.min(a, b), Math.max(a, b)].join(",");
        const edge = edges.get(edgeKey);
        if (edge) edge.count++; else edges.set(edgeKey, { a, b, count: 1 });
      }
      for (const edge of edges.values()) {
        if (edge.count !== 1) continue;
        const a = new THREE.Vector3().fromBufferAttribute(positions, edge.a);
        const b = new THREE.Vector3().fromBufferAttribute(positions, edge.b);
        // The original deck edge ranges from Y=1.48 aft to Y=1.92 at bow.
        if (a.y < 1.4799 || b.y < 1.4799) continue;
        const ka = key(a), kb = key(b);
        rimPoints.set(ka, a); rimPoints.set(kb, b); rimEdges.push([ka, kb]);
      }
      object.visible = false;
    });
    const neighbors = new Map<string, string[]>();
    for (const [a, b] of rimEdges) {
      neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
      neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
    }
    // Follow the continuous port -> bow -> starboard deck seam. The final
    // closing segment is the transom, missing from the source asset panels.
    let current = [...neighbors.keys()].find(id => neighbors.get(id)!.length === 1)!;
    let previous = "";
    const rim: THREE.Vector3[] = [];
    while (current) {
      rim.push(rimPoints.get(current)!);
      const next = neighbors.get(current)!.find(id => id !== previous) ?? "";
      previous = current; current = next;
    }
    const deckY = Math.max(...rim.map(p => p.y));
    model.position.set(-center.x * model.scale.x, hull.depth - hull.draft - deckY * model.scale.y, -center.z * model.scale.z);
    const solid = closedHull(rim, (-hull.draft - model.position.y) / model.scale.y);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(solid.vertices, 3));
    geometry.setIndex(solid.indices);
    const hullMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide });
    const solidMesh = new THREE.Mesh(geometry.toNonIndexed(), hullMaterial);
    geometry.dispose(); solidMesh.geometry.computeVertexNormals();
    solidMesh.name = "Closed naval hull";
    model.add(solidMesh);
    const replacements = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    paints.length = 0;
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const clonePaint = (material: THREE.MeshStandardMaterial) => {
        if (!replacements.has(material)) {
          const copy = material.clone();
          copy.color.setHex(color);
          // Preserve visibility of the original thin, single-surface details.
          copy.side = THREE.DoubleSide;
          replacements.set(material, copy); paints.push(copy);
        }
        return replacements.get(material)!;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clonePaint) : clonePaint(object.material);
    });
    hullMaterial.dispose();
    body.add(model);
  };
  return { root, body, wake, paints, outline, installModel };
}

/** Own the WebGL scene independently of the simulation clock. */
export default function OceanScene({ simulation, snapshot, settings, onSettings, onSignal }: { simulation: RefObject<State>; snapshot: State; settings: Settings; onSettings: (settings: Settings) => void; onSignal: (ship: ShipId, kind: "horn" | "vhf") => void }) {
  const container = useRef<HTMLDivElement>(null);
  const cameraRequest = useRef<{ mode: CameraMode; revision: number }>({ mode: "encounter", revision: 0 });
  const sea = useRef(0.65);
  const [seaState, setSeaState] = useState("0.65");
  const [mode, setMode] = useState<CameraMode>("encounter");
  const [failure, setFailure] = useState("");
  const [panel, setPanel] = useState<"sensors" | "settings" | null>(null);
  const [signalShip, setSignalShip] = useState<ShipId>("own");
  const [sensorView, setSensorView] = useState<SensorView>("observer");
  const [overlays, setOverlays] = useState<OverlayToggles>({ ...defaultOverlays });
  const display = useRef<{ view: SensorView; enabled: OverlayToggles }>({ view: "observer", enabled: { ...defaultOverlays } });
  const presentation = sensorPresentation(snapshot, sensorView, overlays);
  const activeLayers = Object.values(overlays).filter(Boolean).length;
  const transmitter = sensorView === "observer" ? signalShip : sensorView;
  const changeCamera = (next: CameraMode) => {
    setMode(next); cameraRequest.current = { mode: next, revision: cameraRequest.current.revision + 1 };
  };

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
    catch { queueMicrotask(() => setFailure("This browser could not start WebGL. Enable hardware acceleration and reload to view the 3D ocean.")); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.72;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D ocean with two vessels. Drag to orbit, scroll to zoom, right-drag to pan.");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    const contextLost = (event: Event) => { event.preventDefault(); setFailure("The 3D graphics context was lost. Reload the page to restart the ocean view."); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xaecbd6, 0.00012);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 25000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 22;
    controls.maxDistance = 9000;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xc7e9ff, 0x4e676c, 2.6));
    const sun = new THREE.Vector3(-0.4, 0.6, 0.65).normalize();
    const sunlight = new THREE.DirectionalLight(0xffefcc, 3.2);
    sunlight.position.copy(sun).multiplyScalar(1000); scene.add(sunlight);
    const sky = new Sky();
    sky.scale.setScalar(20000);
    sky.material.uniforms.turbidity.value = 3;
    sky.material.uniforms.rayleigh.value = 1.5;
    sky.material.uniforms.mieCoefficient.value = 0.004;
    sky.material.uniforms.mieDirectionalG.value = 0.8;
    sky.material.uniforms.sunPosition.value.copy(sun);
    scene.add(sky);
    const normals = normalTexture();
    const water = new Water(new THREE.PlaneGeometry(14000, 14000, 384, 384), {
      textureWidth: 512, textureHeight: 512, waterNormals: normals,
      sunDirection: sun, sunColor: 0xffefdc, waterColor: 0x005b70,
      distortionScale: 3.5, fog: true,
    });
    water.rotation.x = -Math.PI / 2;
    water.material.uniforms.waveAmplitude = { value: sea.current };
    water.material.vertexShader = water.material.vertexShader
      .replace("uniform float time;", "uniform float time; uniform float waveAmplitude;")
      .replace("mirrorCoord = modelMatrix * vec4( position, 1.0 );", `
        vec3 displaced = position;
        vec3 baseWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        displaced.z += waveAmplitude * (sin(baseWorld.x * 0.065 + baseWorld.z * 0.025 - time * 0.9)
          + 0.35 * sin(baseWorld.x * -0.038 + baseWorld.z * 0.08 - time * 1.15));
        mirrorCoord = modelMatrix * vec4(displaced, 1.0);`)
      .replace("modelViewMatrix * vec4( position, 1.0 )", "modelViewMatrix * vec4( displaced, 1.0 )");
    water.material.fragmentShader = water.material.fragmentShader
      .replace("uniform float time;", "uniform float time; uniform float waveAmplitude;")
      .replace("vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );", `
        float phase1 = worldPosition.x * 0.065 + worldPosition.z * 0.025 - time * 0.9;
        float phase2 = worldPosition.x * -0.038 + worldPosition.z * 0.08 - time * 1.15;
        vec2 slope = waveAmplitude * vec2(0.065*cos(phase1) - 0.0133*cos(phase2), 0.025*cos(phase1) + 0.028*cos(phase2));
        vec3 surfaceNormal = normalize(noise.xzy * vec3(0.65, 1.0, 0.65) + vec3(-slope.x, 0.0, -slope.y));`);
    scene.add(water);
    const own = makeBoat(0x68e0c3, "SHIP 01");
    const target = makeBoat(0xf7be63, "SHIP 02");
    scene.add(own.root, target.root);
    let disposed = false;
    new GLTFLoader().load("/models/naval-battleship.glb", gltf => {
      const sourceMaterials = new Set<THREE.Material>();
      gltf.scene.traverse(object => {
        if (object instanceof THREE.Mesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => sourceMaterials.add(material));
      });
      if (!disposed) {
        const secondModel = gltf.scene.clone(true);
        own.installModel(gltf.scene);
        target.installModel(secondModel);
      } else {
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
      }
      // Per-vessel material clones allow independent collision highlighting.
      sourceMaterials.forEach(material => material.dispose());
    }, undefined, () => {
      if (!disposed) setFailure("The naval model could not be loaded. Showing the fallback vessel; reload to retry.");
    });
    const trailMaterials = [0x68e0c3, 0xf7be63].map(color => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
    const trails = trailMaterials.map(material => new THREE.Line(new THREE.BufferGeometry(), material));
    const predictionMaterials = [0x68e0c3, 0xf7be63].map(color => new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.8, dashSize: 7, gapSize: 4 }));
    const predictions = predictionMaterials.map(material => new THREE.Line(new THREE.BufferGeometry(), material));
    scene.add(...trails, ...predictions);
    const sensorOverlays = createSensorOverlays();
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
    });
    observer.observe(host);
    let frame = 0, cameraRevision = -1, lastTrailTime = -1;
    const previousFocus = new THREE.Vector3();
    const focus = new THREE.Vector3();
    const toWorld = (boat: State["own"]) => new THREE.Vector3(boat.x - WORLD.width / 2, 0, WORLD.height / 2 - boat.y);
    const draw = () => {
      const state = simulation.current;
      const time = state.time;
      const sensorData = sensorPresentation(state, display.current.view, display.current.enabled);
      const amplitude = sea.current;
      water.material.uniforms.time.value = time;
      water.material.uniforms.waveAmplitude.value = amplitude;
      const positions = [toWorld(state.own), toWorld(state.target)];
      [own, target].forEach((mesh, i) => {
        const shipId = i === 0 ? "own" : "target";
        mesh.root.visible = sensorData.physicalShips.includes(shipId);
        const boat = i === 0 ? state.own : state.target;
        const p = positions[i];
        const h = boat.heading * Math.PI / 180;
        const sample = (forward: number, side: number) => surface(p.x + Math.sin(h) * forward + Math.cos(h) * side, p.z - Math.cos(h) * forward + Math.sin(h) * side, time, amplitude);
        mesh.root.position.copy(p);
        mesh.root.rotation.y = -h;
        mesh.body.position.y = sample(0, 0) - 0.5;
        mesh.body.rotation.x = Math.atan2(sample(10, 0) - sample(-10, 0), hull.length);
        mesh.body.rotation.z = Math.atan2(sample(0, 3) - sample(0, -3), hull.beam);
        mesh.wake.position.y = sample(-20, 0) + 0.15;
        mesh.wake.visible = boat.speed > 0.5 && !state.collision;
        mesh.outline.visible = !!state.collision;
        mesh.paints.forEach(paint => {
          paint.emissive.setHex(state.collision ? 0xff3322 : 0x000000);
          paint.emissiveIntensity = state.collision ? 0.6 : 0;
        });
      });
      const request = cameraRequest.current;
      const selected = display.current.view === "target" ? 1 : 0;
      const primary = positions[selected];
      const observed = sensorData.frames[0]?.knownTarget;
      const secondary = display.current.view === "observer" ? positions[1] : observed ? new THREE.Vector3(observed.x - WORLD.width / 2, 0, WORLD.height / 2 - observed.y) : primary;
      focus.copy(request.mode === "follow" ? primary : primary.clone().add(secondary).multiplyScalar(0.5));
      if (request.revision !== cameraRevision) {
        const separation = primary.distanceTo(secondary);
        if (request.mode === "follow") camera.position.copy(focus).add(new THREE.Vector3(48, 30, 65));
        else if (request.mode === "overhead") camera.position.copy(focus).add(new THREE.Vector3(0, Math.max(200, separation * 1.5), 2));
        else camera.position.copy(focus).add(new THREE.Vector3(Math.max(110, separation * 0.65), Math.max(95, separation * 0.65), Math.max(130, separation * 0.85)));
        controls.target.copy(focus); previousFocus.copy(focus); cameraRevision = request.revision;
      } else {
        const delta = focus.clone().sub(previousFocus);
        camera.position.add(delta); controls.target.add(delta); previousFocus.copy(focus);
      }
      trails.forEach((trail, i) => { trail.visible = sensorData.physicalShips.includes(i === 0 ? "own" : "target"); });
      predictions.forEach((prediction, i) => { prediction.visible = sensorData.physicalShips.includes(i === 0 ? "own" : "target") && !state.collision; });
      if (Math.abs(time - lastTrailTime) >= 0.25 || time < lastTrailTime) {
        [state.own, state.target].forEach((boat, i) => {
          const points = boat.trail.map(([x, y]) => new THREE.Vector3(x - WORLD.width / 2, surface(x - WORLD.width / 2, WORLD.height / 2 - y, time, amplitude) + 0.2, WORLD.height / 2 - y));
          const old = trails[i].geometry;
          trails[i].geometry = new THREE.BufferGeometry().setFromPoints(points); old.dispose();
          const projected: THREE.Vector3[] = [];
          let x = boat.x, y = boat.y, heading = boat.heading;
          for (let step = 0; step <= 60; step++) {
            projected.push(new THREE.Vector3(x - WORLD.width / 2, surface(x - WORLD.width / 2, WORLD.height / 2 - y, time, amplitude) + 0.28, WORLD.height / 2 - y));
            const dt = 1;
            const radians = heading * Math.PI / 180;
            x += Math.sin(radians) * boat.speed * 0.514444 * dt;
            y += Math.cos(radians) * boat.speed * 0.514444 * dt;
            heading = (heading + boat.rudder / 35 * boat.speed / 12 * 5 * dt + 360) % 360;
          }
          const projectedGeometry = new THREE.BufferGeometry().setFromPoints(projected);
          const oldPrediction = predictions[i].geometry;
          predictions[i].geometry = projectedGeometry;
          predictions[i].computeLineDistances();
          oldPrediction.dispose();
        });
        lastTrailTime = time;
      }
      controls.update(); renderer.render(scene, camera);
      sensorOverlays.update(sensorData, time);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(sensorOverlays.scene, camera);
      renderer.autoClear = true;
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); sensorOverlays.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          if ("geometry" in object) object.geometry.dispose();
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach(material => materials.add(material));
        }
      });
      materials.forEach(material => {
        if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
        material.dispose();
      });
      water.material.uniforms.mirrorSampler.value.dispose(); normals.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [simulation]);

  return <div className="ocean-scene" onKeyDown={event => { if (event.key === "Escape") setPanel(null); }}>
    <div className="ocean-canvas" ref={container} />
    <div className="ocean-toolbar" aria-label="Simulation view controls">
      <label><span>View</span><select aria-label="Sensor view" value={sensorView} onChange={e => { const view = e.target.value as SensorView; setSensorView(view); display.current = { ...display.current, view }; changeCamera("encounter"); }}><option value="observer">Observer · both ships</option><option value="own">Ship 01 · sensors</option><option value="target">Ship 02 · sensors</option></select></label>
      <label><span>Camera</span><select aria-label="Camera view" value={mode} onChange={e => changeCamera(e.target.value as CameraMode)}><option value="encounter">Overview</option><option value="follow">Follow vessel</option><option value="overhead">Overhead</option></select></label>
      <div className="ocean-environment-inline"><label><span>Visibility</span><select aria-label="Detection visibility" value={settings.restricted ? "fog" : "clear"} disabled={!!snapshot.collision} onChange={e => onSettings({ ...settings, visibility: e.target.value === "fog" ? 150 : 2000, restricted: e.target.value === "fog" })}><option value="clear">Clear / {rangeText(2000)}</option><option value="fog">Fog / {rangeText(150)}</option></select></label><label><span>Light</span><select aria-label="Detection light conditions" value={settings.night ? "night" : "day"} disabled={!!snapshot.collision} onChange={e => onSettings({ ...settings, night: e.target.value === "night" })}><option value="day">Day / vessel appearance</option><option value="night">Night / navigation lights</option></select></label></div>
      <div className="ocean-toolbar-actions"><button aria-expanded={panel === "sensors"} aria-controls="scene-sensors" onClick={() => setPanel(panel === "sensors" ? null : "sensors")}>Sensors <span className="layer-count">{activeLayers}</span></button><button aria-expanded={panel === "settings"} aria-controls="scene-settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>Settings</button></div>
    </div>
    {panel === "sensors" && <section id="scene-sensors" className="ocean-popover ocean-sensors" aria-label="Sensor display options">
      <header><strong>Detection layers</strong><button aria-label="Close sensor options" onClick={() => setPanel(null)}>×</button></header>
      <p>Show observations received by the selected watch.</p>
      <div className="ocean-layer-grid">{(Object.keys(defaultOverlays) as (keyof OverlayToggles)[]).map(key => <label key={key}><span className="sensor-swatch" style={{ backgroundColor: sensorColors[key] }} /><span>{key === "visual" ? "Lookout" : key === "sound" ? "Sound" : key.toUpperCase()}</span><input style={{ accentColor: sensorColors[key] }} type="checkbox" checked={overlays[key]} aria-label={`${key === "arpa" ? "ARPA" : key === "ais" ? "AIS" : key === "vhf" ? "VHF" : key} overlay`} onChange={e => { const enabled = { ...overlays, [key]: e.target.checked }; setOverlays(enabled); display.current = { ...display.current, enabled }; }} /></label>)}</div>
      <footer>Circle · radar &nbsp; Triangle · AIS<br />Dashed line · ARPA estimate &nbsp; Solid line · lookout</footer>
    </section>}
    {panel === "settings" && <section id="scene-settings" className="ocean-popover ocean-settings" aria-label="Scene settings">
      <header><strong>Scene settings</strong><button aria-label="Close scene settings" onClick={() => setPanel(null)}>×</button></header>
      <label className="ocean-setting-row">Sea state<select aria-label="Sea state" value={seaState} onChange={e => { setSeaState(e.target.value); sea.current = Number(e.target.value); }}><option value="0.15">Calm</option><option value="0.65">Moderate</option><option value="1.2">Rough</option></select></label>
      <div className="ocean-test-signals"><label className="ocean-setting-row">Test signals{sensorView === "observer" ? <select aria-label="Signal sender" value={signalShip} onChange={e => setSignalShip(e.target.value as ShipId)}><option value="own">Ship 01</option><option value="target">Ship 02</option></select> : <span>Ship {transmitter === "own" ? "01" : "02"}</span>}</label><div><button disabled={!!snapshot.collision} onClick={() => onSignal(transmitter, "horn")}>Sound horn</button><button disabled={!!snapshot.collision || !snapshot.bridge.settings.equipment[transmitter].vhf} onClick={() => onSignal(transmitter, "vhf")}>VHF request</button></div><p>Run the simulation to deliver test signals.</p></div>
      <footer>Radar range · {rangeText(6000)}<br />ARPA vector · 60 s</footer>
    </section>}
    {!!activeLayers && <div className="ocean-readouts" aria-label="Sensor view status">{presentation.frames.map(frame => <div className="ocean-watch-readout" key={frame.id}><strong><i style={{ backgroundColor: frame.id === "own" ? "#68e0c3" : "#f7be63" }} />{frame.id === "own" ? "01" : "02"}</strong><div>
      {overlays.visual && <span style={{ color: sensorColors.visual }}>Lookout <b>{frame.visual ? "contact" : "—"}</b></span>}
      {overlays.radar && <span style={{ color: sensorColors.radar }}>Radar <b>{frame.radar ? `${frame.radar.age.toFixed(1)}s` : "—"}</b></span>}
      {overlays.arpa && <span style={{ color: sensorColors.arpa }}>ARPA <b>{frame.prediction ? `CPA ${rangeText(frame.prediction.dcpa)}` : "acquiring"}</b></span>}
      {overlays.ais && <span style={{ color: sensorColors.ais }}>AIS <b>{frame.ais ? `${frame.ais.age.toFixed(1)}s old` : "—"}</b></span>}
      {overlays.sound && <span style={{ color: sensorColors.sound }}>Sound <b>{frame.hearing.length ? "heard" : "—"}</b></span>}
      {overlays.vhf && <span style={{ color: sensorColors.vhf }}>VHF <b>{frame.vhf.length ? "received" : "—"}</b></span>}
    </div></div>)}</div>}
    <div className="ocean-footer"><span>{sensorView === "observer" ? "Observer" : `Ship ${sensorView === "own" ? "01" : "02"} · received observations`}<span className="ocean-gesture-hint"> · Drag to orbit · Scroll to zoom</span></span><a href="https://poly.pizza/m/cqV6mUkn7Ow" target="_blank" rel="noreferrer" title="Battleship model by angelo raffaele Catalano, CC BY 3.0">Model: angelo raffaele Catalano · CC BY 3.0</a></div>
    {failure && <div className="graphics-error" role="alert">{failure}</div>}
  </div>;
}
