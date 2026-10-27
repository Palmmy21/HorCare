import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LocateFixed } from 'lucide-react';
import { rowsOf, type FloorPlan, type PlanKind } from '../../shared/floorPlan';
import type { Tone, UnitMark } from '../../shared/planLayers';
import type { BoardUnit } from './FloorPlanBoard';

// The plan as a small 3D model: floors stacked as storeys, zones and streets laid out on the ground. Same data and
// layer colours as the 2D board; clicking a unit selects it the same way. Loaded only when someone opens the 3D view.

const GAP = 0.14;
const FLOOR_H = 1.3;
const AISLE = 1.15;
const UNIT_H: Record<PlanKind, number> = { floors: 0.92, zones: 0.5, streets: 0.62 };
const ROOF_H = 0.42;

interface Props {
  plan: FloorPlan;
  kind: PlanKind;
  units: Record<string, BoardUnit>;
  marks: Record<string, UnitMark>;
  tenantGroups: Record<string, string[]>;
  groupLabel: string;
  unitLabel: string;
  selected: string[];
  onUnitClick: (roomId: string, additive: boolean) => void;
  onFallback: () => void;
}

interface Palette {
  dark: boolean;
  tone: Record<Tone, THREE.Color>;
  dot: Partial<Record<Tone, string>>;
  primary: THREE.Color;
  primaryLight: THREE.Color;
  edge: THREE.Color;
  slab: THREE.Color;
  road: THREE.Color;
  tagBg: string;
  tagText: string;
  tagPrimary: string;
  font: string;
}

function readPalette(): Palette {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const col = (name: string, fallback: string) => new THREE.Color(v(name, fallback));
  const dark = root.classList.contains('dark');
  const primary = col('--color-primary', '#0A6CC2');
  const surface = col('--color-white', '#ffffff');
  return {
    dark,
    tone: {
      base: dark ? col('--color-gray-300', '#2E5074').lerp(primary, 0.25) : surface.clone().lerp(primary, 0.1),
      muted: col('--color-gray-400', '#8FA3B8'),
      good: col('--color-success-light', '#22A35A'),
      warn: col('--color-warning-light', '#F59E2E'),
      bad: col('--color-danger-light', '#E35D5D'),
    },
    dot: { good: v('--color-success', '#15803D'), warn: v('--color-accent', '#E8740C'), bad: v('--color-danger', '#C62828') },
    primary,
    primaryLight: col('--color-primary-light', '#3D8FD6'),
    edge: col('--color-gray-500', '#557089'),
    slab: dark ? col('--color-gray-100', '#17304B') : surface.clone(),
    road: col('--color-gray-300', '#C3D0DE'),
    tagBg: v('--color-white', '#ffffff'),
    tagText: v('--color-gray-900', '#102A43'),
    tagPrimary: v('--color-primary', '#0A6CC2'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
  };
}

interface UnitObj {
  id: string;
  groupId: string;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  roofMat?: THREE.MeshStandardMaterial;
  roof?: THREE.Mesh;
  edges: THREE.LineSegments;
  edgeMat: THREE.LineBasicMaterial;
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  height: number;
  top: number;
}

interface GroupObj {
  id: string;
  level: number;
  obj: THREE.Group;
  baseY: number;
  targetY: number;
  fade: number;
  targetFade: number;
  center: THREE.Vector3;
  mats: THREE.Material[];
}

interface Core {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sun: THREE.DirectionalLight;
  ground: THREE.Mesh;
  content: THREE.Group;
  lookAt: THREE.Vector3 | null;
  dirty: boolean;
}

/** Opacity = the material's own (glass for vacant units) × its group's fade. */
function setOpacity(m: THREE.Material, fade: number) {
  const o = ((m.userData.base as number | undefined) ?? 1) * fade;
  m.opacity = o;
  const transparent = o < 0.999 || m.userData.alwaysTransparent === true;
  if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
  m.depthWrite = o >= 0.5;
  m.visible = o > 0.01;
}

function drawTag(canvas: HTMLCanvasElement, text: string, pal: Palette, opts: { dot?: string; strong?: boolean; big?: boolean }) {
  const H = opts.big ? 60 : 52;
  const size = opts.big ? 30 : 28;
  const ctx = canvas.getContext('2d')!;
  const font = `600 ${size}px ${pal.font}`;
  ctx.font = font;
  const pad = 14;
  const dotW = opts.dot ? 20 : 0;
  const W = Math.ceil(pad * 2 + dotW + ctx.measureText(text).width);
  canvas.width = W; canvas.height = H;
  ctx.font = font;
  ctx.beginPath();
  ctx.roundRect(2, 2, W - 4, H - 4, (H - 4) / 2);
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = pal.tagBg;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = opts.strong ? 4 : 1.5;
  ctx.strokeStyle = opts.strong ? pal.tagPrimary : 'rgba(127,145,165,0.45)';
  ctx.stroke();
  if (opts.dot) {
    ctx.beginPath();
    ctx.arc(pad + 6, H / 2, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = opts.dot;
    ctx.fill();
  }
  ctx.fillStyle = opts.big ? pal.tagPrimary : pal.tagText;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad + dotW, H / 2 + 1);
}

function tagSprite(text: string, pal: Palette, worldH: number, opts: { dot?: string; strong?: boolean; big?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  drawTag(canvas, text, pal, opts);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  mat.userData.alwaysTransparent = true;
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(worldH * (canvas.width / canvas.height), worldH, 1);
  return { sprite, canvas, tex, mat };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse(o => {
    const any = o as THREE.Mesh;
    any.geometry?.dispose();
    const mats = Array.isArray(any.material) ? any.material : any.material ? [any.material] : [];
    for (const m of mats) { (m as THREE.SpriteMaterial).map?.dispose(); m.dispose(); }
  });
}

/** Where each floor / zone heads when one is picked: the floors above it lift away and everything else fades. */
function setFocusTargets(groups: GroupObj[], focusId: string | null, kind: PlanKind): GroupObj | undefined {
  const focus = groups.find(g => g.id === focusId);
  for (const g of groups) {
    if (!focus || g === focus) { g.targetY = g.baseY; g.targetFade = 1; continue; }
    g.targetY = kind === 'floors' && g.level > focus.level ? g.baseY + 3.4 + (g.level - focus.level) * 0.4 : g.baseY;
    g.targetFade = 0.1;
  }
  return focus;
}

function hasWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch { return false; }
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function FloorPlan3D({ plan, kind, units, marks, tenantGroups, groupLabel, unitLabel, selected, onUnitClick, onFallback }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  const unitObjs = useRef(new Map<string, UnitObj>());
  const groupObjs = useRef<GroupObj[]>([]);
  const palRef = useRef<Palette | null>(null);
  const hoverRef = useRef<string | null>(null);
  const fitRef = useRef<() => void>(() => {});
  const builtOnce = useRef(false);
  const lastFocus = useRef<string | null>(null);
  const latest = useRef({ marks, units, tenantGroups, selected, onUnitClick });
  const [failed, setFailed] = useState(() => !hasWebGL());
  const [theme, setTheme] = useState(0);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const reduced = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useLayoutEffect(() => { latest.current = { marks, units, tenantGroups, selected, onUnitClick }; });

  // the app switches theme with a class on <html>; colours are read from the CSS tokens again when it changes
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(t => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  /** Colours, edges, lift and tags from the current layer, selection and hover. */
  const applyLook = useCallback(() => {
    const c = core.current;
    const pal = palRef.current;
    if (!c || !pal) return;
    const { marks: mk, selected: sel, tenantGroups: tg } = latest.current;
    const chosen = new Set(sel);
    const hover = hoverRef.current;
    const linked = new Set([...sel.flatMap(id => tg[id] ?? []), ...(hover ? tg[hover] ?? [] : [])]);
    const black = new THREE.Color(0x000000);
    for (const u of unitObjs.current.values()) {
      const tone = mk[u.id]?.tone ?? 'base';
      const muted = tone === 'muted';
      const isSel = chosen.has(u.id);
      u.mat.color.copy(pal.tone[tone]);
      u.mat.userData.base = muted ? 0.2 : 1;
      u.mat.emissive.copy(isSel || hover === u.id ? pal.primary : black);
      u.mat.emissiveIntensity = isSel ? 0.38 : hover === u.id ? 0.2 : 0;
      u.mesh.castShadow = !muted;
      if (u.roofMat) {
        u.roofMat.color.copy(pal.tone[tone]).multiplyScalar(muted ? 1 : 0.72);
        u.roofMat.userData.base = muted ? 0.2 : 1;
        u.roofMat.emissive.copy(u.mat.emissive);
        u.roofMat.emissiveIntensity = u.mat.emissiveIntensity;
      }
      u.edgeMat.color.copy(isSel ? pal.primary : linked.has(u.id) ? pal.primaryLight : pal.edge);
      u.edgeMat.userData.base = isSel || linked.has(u.id) ? 1 : muted ? 0.75 : 0.18;
      const lift = isSel ? 0.14 : 0;
      u.mesh.position.y = u.height / 2 + lift;
      u.edges.position.y = u.height / 2 + lift;
      if (u.roof) u.roof.position.y = u.height + ROOF_H / 2 + lift;
      u.label.position.y = u.top + 0.24 + lift;
      const text = trim(latest.current.units[u.id]?.number ?? '…', 10);
      drawTag(u.canvas, text, pal, { dot: pal.dot[tone], strong: isSel });
      u.tex.needsUpdate = true;
      u.label.scale.set(0.26 * (u.canvas.width / u.canvas.height), 0.26, 1);
    }
    for (const g of groupObjs.current) for (const m of g.mats) setOpacity(m, g.fade);
    c.dirty = true;
  }, []);

  // renderer, camera, lights and the render loop — once
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const unitMap = unitObjs.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.className = 'plan3d-canvas';
    host.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 2.5;
    controls.maxDistance = 260;
    controls.autoRotateSpeed = 0.5;
    controls.autoRotate = !reduced.current;
    controls.addEventListener('start', () => { controls.autoRotate = false; if (core.current) core.current.lookAt = null; });

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9bb0, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 5;
    scene.add(sun, sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const content = new THREE.Group();
    scene.add(content);
    core.current = { renderer, scene, camera, controls, sun, ground, content, lookAt: null, dirty: true };

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (core.current) core.current.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    /** Floors sliding apart / fading when one is picked, and the first drop-in. */
    const step = () => {
      let moving = false;
      for (const g of groupObjs.current) {
        const dy = g.targetY - g.obj.position.y;
        const df = g.targetFade - g.fade;
        if (Math.abs(dy) > 0.002 || Math.abs(df) > 0.002) {
          moving = true;
          g.obj.position.y += dy * 0.12;
          g.fade += df * 0.14;
          for (const m of g.mats) setOpacity(m, g.fade);
        } else if (dy !== 0 || df !== 0) {
          g.obj.position.y = g.targetY;
          g.fade = g.targetFade;
          for (const m of g.mats) setOpacity(m, g.fade);
          moving = true;
        }
      }
      const c = core.current;
      if (c?.lookAt) {
        c.controls.target.lerp(c.lookAt, 0.1);
        if (c.controls.target.distanceTo(c.lookAt) < 0.01) c.lookAt = null;
        moving = true;
      }
      return moving;
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = core.current;
      if (!c) return;
      const animating = step();
      const moved = controls.update();
      if (moved || animating || c.dirty) {
        renderer.render(scene, camera);
        c.dirty = false;
      }
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeTree(scene);
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      core.current = null;
      unitMap.clear();
      groupObjs.current = [];
    };
  }, []);

  // the model — rebuilt when the plan, the tiles' text or the theme changes
  useEffect(() => {
    const c = core.current;
    if (!c) return;
    disposeTree(c.content);
    c.content.clear();
    unitObjs.current.clear();
    const pal = readPalette();
    palRef.current = pal;
    c.renderer.toneMappingExposure = pal.dark ? 0.95 : 1.05;

    const h = UNIT_H[kind];
    const maxCols = Math.max(1, ...plan.groups.map(g => g.cols));
    const maxRows = Math.max(1, ...plan.groups.map(g => rowsOf(g)));
    const geos = new Map<string, THREE.BufferGeometry>();
    const geo = (key: string, make: () => THREE.BufferGeometry) => {
      let g = geos.get(key);
      if (!g) { g = make(); geos.set(key, g); }
      return g;
    };
    const animate = !builtOnce.current && !reduced.current;
    const n = plan.groups.length;
    const groups: GroupObj[] = [];
    let z = 0;

    plan.groups.forEach((g, gi) => {
      const rows = Math.max(1, rowsOf(g));
      const level = kind === 'floors' ? n - 1 - gi : 0;
      const baseY = level * FLOOR_H;
      const x0 = -maxCols / 2;
      const z0 = kind === 'floors' ? -maxRows / 2 : z;
      const obj = new THREE.Group();
      const mats: THREE.Material[] = [];

      const slabT = kind === 'floors' ? 0.12 : 0.05;
      const slabW = g.cols + 0.5, slabD = rows + 0.5;
      const slabMat = new THREE.MeshStandardMaterial({ color: pal.slab, roughness: 0.8 });
      const slab = new THREE.Mesh(geo(`s${slabW}:${slabD}:${slabT}`, () => new RoundedBoxGeometry(slabW, slabT, slabD, 2, slabT / 2.2)), slabMat);
      slab.position.set(x0 + g.cols / 2, -slabT / 2, z0 + rows / 2);
      slab.receiveShadow = true;
      slab.castShadow = kind === 'floors';
      obj.add(slab);
      mats.push(slabMat);

      const name = tagSprite(trim(g.name, 18), pal, 0.34, { big: true });
      name.sprite.center.set(1, 0.5);
      name.sprite.position.set(x0 - 0.45, kind === 'floors' ? h / 2 : 0.3, z0 + rows / 2);
      obj.add(name.sprite);
      mats.push(name.mat);

      for (const cell of g.cells) {
        if (!units[cell.room_id]) continue;
        const fw = cell.w - GAP, fd = cell.h - GAP;
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.02 });
        const mesh = new THREE.Mesh(geo(`u${fw}:${fd}`, () => new RoundedBoxGeometry(fw, h, fd, 3, 0.07)), mat);
        const cx = x0 + cell.col + cell.w / 2, cz = z0 + cell.row + cell.h / 2;
        mesh.position.set(cx, h / 2, cz);
        mesh.receiveShadow = true;
        mesh.userData.roomId = cell.room_id;
        obj.add(mesh);

        const edgeMat = new THREE.LineBasicMaterial({ transparent: true });
        const edges = new THREE.LineSegments(geo(`e${fw}:${fd}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(fw, h, fd))), edgeMat);
        edges.position.set(cx, h / 2, cz);
        obj.add(edges);

        let roof: THREE.Mesh | undefined, roofMat: THREE.MeshStandardMaterial | undefined;
        if (kind === 'streets') {
          roofMat = new THREE.MeshStandardMaterial({ roughness: 0.65 });
          roof = new THREE.Mesh(geo('roof', () => new THREE.ConeGeometry(Math.SQRT1_2, ROOF_H, 4).rotateY(Math.PI / 4)), roofMat);
          roof.scale.set(fw + 0.08, 1, fd + 0.08);
          roof.position.set(cx, h + ROOF_H / 2, cz);
          roof.castShadow = true;
          roof.userData.roomId = cell.room_id;
          obj.add(roof);
          mats.push(roofMat);
        }

        const tag = tagSprite('', pal, 0.26);
        tag.sprite.position.set(cx, h + 0.24, cz);
        obj.add(tag.sprite);
        mats.push(mat, edgeMat, tag.mat);
        unitObjs.current.set(cell.room_id, {
          id: cell.room_id, groupId: g.id, mesh, mat, roof, roofMat, edges, edgeMat, label: tag.sprite, canvas: tag.canvas, tex: tag.tex,
          height: h, top: h + (roof ? ROOF_H : 0),
        });
      }

      if (kind === 'streets' && gi < n - 1) {
        const road = new THREE.Mesh(new THREE.PlaneGeometry(maxCols + 1.4, AISLE * 0.62), new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.95 }));
        road.rotation.x = -Math.PI / 2;
        road.position.set(0, 0.003, z0 + rows + 0.25 + AISLE / 2 - 0.12);
        road.receiveShadow = true;
        c.content.add(road);
      }

      obj.position.y = baseY;
      c.content.add(obj);
      groups.push({ id: g.id, level, obj, baseY, targetY: baseY, fade: 1, targetFade: 1, mats, center: new THREE.Vector3(0, baseY + h / 2, z0 + rows / 2) });
      if (kind !== 'floors') z += rows + AISLE;
    });

    c.content.position.z = kind === 'floors' ? 0 : -(z - AISLE) / 2;
    for (const g of groups) g.center.z += c.content.position.z;
    groupObjs.current = groups;

    // bounds with every floor in place, before the drop-in moves them
    const box = new THREE.Box3().setFromObject(c.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 1, 2));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 2);
    const center = sphere.center;

    c.ground.scale.set(r * 8, r * 8, 1);
    c.ground.position.set(center.x, -0.13, center.z);
    c.sun.position.set(center.x + r * 0.7, center.y + r * 1.6, center.z + r * 1.1);
    c.sun.target.position.copy(center);
    const sc = c.sun.shadow.camera;
    sc.left = -r * 1.3; sc.right = r * 1.3; sc.top = r * 1.3; sc.bottom = -r * 1.3;
    sc.near = 0.1; sc.far = r * 5;
    sc.updateProjectionMatrix();

    fitRef.current = () => {
      const cur = core.current;
      if (!cur) return;
      const dist = r / Math.sin(THREE.MathUtils.degToRad(cur.camera.fov / 2)) * (cur.camera.aspect < 1 ? 1.35 : 1.05);
      const dir = new THREE.Vector3(0.85, 0.75, 1.3).normalize();
      cur.camera.position.copy(center).addScaledVector(dir, dist);
      cur.camera.near = Math.max(0.05, dist / 100);
      cur.camera.far = dist * 6;
      cur.camera.updateProjectionMatrix();
      cur.controls.target.copy(center);
      cur.controls.maxDistance = dist * 2.5;
      cur.lookAt = null;
      cur.controls.update();
      cur.dirty = true;
    };
    if (!builtOnce.current) fitRef.current();

    if (animate) {
      groups.forEach((g, i) => {
        g.obj.position.y = g.baseY + 2.4 + (kind === 'floors' ? g.level * 0.35 : i * 0.25);
        g.fade = 0;
      });
    }
    builtOnce.current = true;
    applyLook();
  }, [plan, kind, units, theme, applyLook]);

  useEffect(() => { applyLook(); }, [marks, selected, tenantGroups, applyLook]);

  // picking one floor / zone: the floors above it lift away, the rest fade, and the camera turns to it
  useEffect(() => {
    const groups = groupObjs.current;
    const focus = setFocusTargets(groups, focusGroup, kind);
    const c = core.current;
    // a rebuild keeps the picked floor apart; only an actual change of floor turns the camera
    if (c && lastFocus.current !== focusGroup) {
      lastFocus.current = focusGroup;
      c.controls.autoRotate = false;
      if (focus) c.lookAt = focus.center.clone();
      else if (groups.length) {
        const box = new THREE.Box3();
        for (const g of groups) box.expandByPoint(g.center.clone().setY(g.baseY));
        c.lookAt = box.getCenter(new THREE.Vector3());
      }
      c.dirty = true;
    }
    if (c) c.dirty = true;
  }, [focusGroup, kind, plan, units, theme]);

  // pointer: hover tag + highlight, click to select (a drag that rotates is not a click)
  useEffect(() => {
    const c = core.current;
    const host = hostRef.current;
    if (!c || !host) return;
    const el = c.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;

    const pick = (e: PointerEvent): string | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, c.camera);
      const live = new Set(groupObjs.current.filter(g => g.targetFade > 0.5).map(g => g.id));
      const targets: THREE.Object3D[] = [];
      for (const u of unitObjs.current.values()) if (live.has(u.groupId)) { targets.push(u.mesh); if (u.roof) targets.push(u.roof); }
      const hit = ray.intersectObjects(targets, false)[0];
      return (hit?.object.userData.roomId as string | undefined) ?? null;
    };

    const showTip = (id: string | null, e: PointerEvent) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (!id) { tip.hidden = true; return; }
      const { units: us, marks: mk } = latest.current;
      const u = us[id];
      tip.textContent = [u?.number, u?.sub, u?.meta, mk[id]?.label].filter(Boolean).join(' · ');
      const rect = host.getBoundingClientRect();
      tip.style.transform = `translate(${Math.min(e.clientX - rect.left + 14, rect.width - 220)}px, ${e.clientY - rect.top + 16}px)`;
      tip.hidden = false;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const id = pick(e);
      showTip(id, e);
      el.style.cursor = id ? 'pointer' : 'grab';
      if (id !== hoverRef.current) { hoverRef.current = id; applyLook(); }
    };
    const onLeave = () => {
      if (tipRef.current) tipRef.current.hidden = true;
      if (hoverRef.current) { hoverRef.current = null; applyLook(); }
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const id = pick(e);
      if (id) latest.current.onUnitClick(id, e.shiftKey || e.metaKey || e.ctrlKey);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [applyLook]);

  if (failed) {
    return (
      <div className="plan3d plan3d-failed">
        <p>เบราว์เซอร์หรืออุปกรณ์นี้แสดงผัง 3 มิติไม่ได้ (ไม่รองรับ WebGL)</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={onFallback}>กลับไปดูผัง 2 มิติ</button>
      </div>
    );
  }

  const count = Object.keys(units).length;
  return (
    <div className="plan3d" ref={hostRef} role="img" aria-label={`ผัง 3 มิติ ${plan.groups.length} ${groupLabel} ${count} ${unitLabel} — ใช้ผัง 2 มิติเพื่อเลือกด้วยแป้นพิมพ์`}>
      {plan.groups.length > 1 && (
        <div className="plan3d-floors" role="group" aria-label={`เลือก${groupLabel}`}>
          <button type="button" className={`plan3d-chip${focusGroup === null ? ' active' : ''}`} aria-pressed={focusGroup === null} onClick={() => setFocusGroup(null)}>ทุก{groupLabel}</button>
          {plan.groups.map(g => (
            <button key={g.id} type="button" className={`plan3d-chip${focusGroup === g.id ? ' active' : ''}`} aria-pressed={focusGroup === g.id}
              onClick={() => setFocusGroup(f => (f === g.id ? null : g.id))}>{g.name}</button>
          ))}
        </div>
      )}
      <button type="button" className="plan3d-reset" onClick={() => { setFocusGroup(null); fitRef.current(); }} aria-label="กลับมุมมองเริ่มต้น" title="กลับมุมมองเริ่มต้น">
        <LocateFixed size={16} aria-hidden />
      </button>
      <p className="plan3d-hint">ลากเพื่อหมุน · ล้อเมาส์/สองนิ้วเพื่อซูม · คลิกขวาลากเพื่อเลื่อน · คลิก{unitLabel}เพื่อดูรายละเอียด</p>
      <div className="plan3d-tip" ref={tipRef} hidden />
    </div>
  );
}
