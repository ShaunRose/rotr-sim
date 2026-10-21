"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Water } from "three/addons/objects/Water.js";
import { Sky } from "three/addons/objects/Sky.js";
import { hull, initialState } from "./model.mjs";

type State = ReturnType<typeof initialState>;
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

/** Render a launch around the same box hull dimensions used by Vessel.js. */
function makeBoat(color: number, label: string) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.12 });
  const red = new THREE.MeshStandardMaterial({ color: 0x792e28, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0efdf, roughness: 0.55 });
  const deck = new THREE.MeshStandardMaterial({ color: 0x47585b, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17292e, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x254d60, roughness: 0.12, metalness: 0.55 });
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); body.add(mesh); return mesh;
  };
  addBox(hull.beam, hull.draft, hull.length, 0, -hull.draft / 2, 0, red);
  addBox(hull.beam, hull.depth - hull.draft, hull.length, 0, (hull.depth - hull.draft) / 2, 0, paint);
  addBox(6.08, 0.3, 20.08, 0, 0.22, 0, dark);
  addBox(5.8, 0.15, 19.8, 0, 2.55, 0, deck);
  addBox(4.6, 2.5, 6.6, 0, 3.86, -1.8, white);
  addBox(4.95, 0.2, 7, 0, 5.2, -1.8, white);
  addBox(3.9, 1.1, 0.06, 0, 4.1, -5.12, glass);
  addBox(0.06, 1.1, 4.5, -2.32, 4.1, -2, glass);
  addBox(0.06, 1.1, 4.5, 2.32, 4.1, -2, glass);
  for (const x of [-1.1, 0, 1.1]) addBox(0.09, 1.2, 0.09, x, 4.1, -5.17, white);
  addBox(1.4, 2.1, 1.7, 0, 3.65, 3.2, paint);
  addBox(1.5, 0.4, 1.8, 0, 4.8, 3.2, dark);
  addBox(0.15, 3.4, 0.15, 0, 6.9, -1.4, white);
  addBox(3.2, 0.12, 0.2, 0, 8, -1.4, white);
  addBox(1.7, 0.18, 0.4, 0, 8.65, -1.4, dark);
  for (const side of [-1, 1]) {
    for (let z = -9; z <= 9; z += 3) addBox(0.08, 0.9, 0.08, side * 2.75, 3.05, z, white);
    addBox(0.08, 0.08, 18, side * 2.75, 3.5, 0, white);
    for (const z of [-7, 0, 7]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 8, 16), dark);
      tyre.rotation.y = Math.PI / 2; tyre.position.set(side * 3.1, 1.2, z); body.add(tyre);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x36ff88 : 0xff4433 }));
    lamp.position.set(side * 2.4, 5.3, -4.5); body.add(lamp);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(8, 27, 35, 0.85)"; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.font = "600 32px Arial"; ctx.textAlign = "center"; ctx.fillText(label, 256, 59);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.position.y = 14; sprite.scale.set(22, 4.1, 1); root.add(sprite);
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
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.12, 27); root.add(wake);
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(hull.beam + 0.2, hull.depth + 0.2, hull.length + 0.2)),
    new THREE.LineBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.95 }),
  );
  outline.position.y = hull.depth / 2 - hull.draft;
  outline.visible = false;
  body.add(outline);
  return { root, body, wake, paint, outline };
}

/** Own the WebGL scene independently of the simulation clock. */
export default function OceanScene({ simulation }: { simulation: RefObject<State> }) {
  const container = useRef<HTMLDivElement>(null);
  const cameraRequest = useRef<{ mode: CameraMode; revision: number }>({ mode: "follow", revision: 0 });
  const sea = useRef(0.65);
  const [mode, setMode] = useState<CameraMode>("follow");
  const [failure, setFailure] = useState("");
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
    controls.maxDistance = 1800;
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
    const water = new Water(new THREE.PlaneGeometry(6000, 6000, 384, 384), {
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
    const own = makeBoat(0x68e0c3, "01 / OWN VESSEL");
    const target = makeBoat(0xf7be63, "02 / TARGET");
    scene.add(own.root, target.root);
    const trailMaterials = [0x68e0c3, 0xf7be63].map(color => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
    const trails = trailMaterials.map(material => new THREE.Line(new THREE.BufferGeometry(), material));
    scene.add(...trails);
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth, height = host.clientHeight;
      renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
    });
    observer.observe(host);
    let frame = 0, cameraRevision = -1, lastTrailTime = -1;
    const previousFocus = new THREE.Vector3();
    const focus = new THREE.Vector3();
    const toWorld = (boat: State["own"]) => new THREE.Vector3(boat.x - 600, 0, 400 - boat.y);
    const draw = () => {
      const state = simulation.current;
      const time = state.time;
      const amplitude = sea.current;
      water.material.uniforms.time.value = time;
      water.material.uniforms.waveAmplitude.value = amplitude;
      const positions = [toWorld(state.own), toWorld(state.target)];
      [own, target].forEach((mesh, i) => {
        const boat = i === 0 ? state.own : state.target;
        const p = positions[i];
        const h = boat.heading * Math.PI / 180;
        const sample = (forward: number, side: number) => surface(p.x + Math.sin(h) * forward + Math.cos(h) * side, p.z - Math.cos(h) * forward + Math.sin(h) * side, time, amplitude);
        mesh.root.position.copy(p);
        mesh.root.rotation.y = -h;
        mesh.body.position.y = sample(0, 0);
        mesh.body.rotation.x = Math.atan2(sample(10, 0) - sample(-10, 0), hull.length);
        mesh.body.rotation.z = Math.atan2(sample(0, 3) - sample(0, -3), hull.beam);
        mesh.wake.position.y = sample(-20, 0) + 0.15;
        mesh.wake.visible = boat.speed > 0.5 && !state.collision;
        mesh.outline.visible = !!state.collision;
        mesh.paint.emissive.setHex(state.collision ? 0xff3322 : 0x000000);
        mesh.paint.emissiveIntensity = state.collision ? 0.6 : 0;
      });
      const request = cameraRequest.current;
      focus.copy(request.mode === "follow" ? positions[0] : positions[0].clone().add(positions[1]).multiplyScalar(0.5));
      if (request.revision !== cameraRevision) {
        const separation = positions[0].distanceTo(positions[1]);
        if (request.mode === "follow") camera.position.copy(focus).add(new THREE.Vector3(48, 30, 65));
        else if (request.mode === "overhead") camera.position.copy(focus).add(new THREE.Vector3(0, Math.max(200, separation * 1.5), 2));
        else camera.position.copy(focus).add(new THREE.Vector3(Math.max(110, separation * 0.65), Math.max(95, separation * 0.65), Math.max(130, separation * 0.85)));
        controls.target.copy(focus); previousFocus.copy(focus); cameraRevision = request.revision;
      } else {
        const delta = focus.clone().sub(previousFocus);
        camera.position.add(delta); controls.target.add(delta); previousFocus.copy(focus);
      }
      if (Math.abs(time - lastTrailTime) >= 0.25 || time < lastTrailTime) {
        [state.own, state.target].forEach((boat, i) => {
          const points = boat.trail.map(([x, y]) => new THREE.Vector3(x - 600, surface(x - 600, 400 - y, time, amplitude) + 0.2, 400 - y));
          const old = trails[i].geometry;
          trails[i].geometry = new THREE.BufferGeometry().setFromPoints(points); old.dispose();
        });
        lastTrailTime = time;
      }
      controls.update(); renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
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

  return <div className="ocean-scene">
    <div className="ocean-canvas" ref={container} />
    <div className="scene-controls" aria-label="3D camera controls">
      {(["follow", "encounter", "overhead"] as const).map(camera => <button key={camera} aria-pressed={mode === camera} onClick={() => changeCamera(camera)}>{camera === "follow" ? "Follow vessel" : camera === "encounter" ? "Both vessels" : "Overhead"}</button>)}
      <label>Sea <select aria-label="Sea state" defaultValue="0.65" onChange={e => { sea.current = Number(e.target.value); }}><option value="0.15">Calm</option><option value="0.65">Moderate</option><option value="1.2">Rough</option></select></label>
    </div>
    <div className="scene-caption"><span className="scene-live-dot" /> 3D OCEAN <span>Drag to orbit / Scroll to zoom / Right-drag to pan</span></div>
    {failure && <div className="graphics-error" role="alert">{failure}</div>}
  </div>;
}
