import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import type { LatLng } from "../types";
import { ELEVATION_LAYER_ID, ribbonAt, type ElevationRibbon } from "./elevationRibbon";
import { FLY_ZOOM } from "./layers";
import { TERRAIN_EXAGGERATION } from "./style";

/**
 * Draws the elevation ribbon with three.js inside MapLibre's own WebGL
 * context, so it shares the camera and depth with the aerial imagery, terrain
 * and buildings instead of floating over them on a second canvas.
 *
 * HEIGHTS. Vertices hold true altitude: DEM elevation with the terrain's
 * exaggeration applied, which is what `queryTerrainElevation` returns.
 * MapLibre's matrix already accounts for the camera sitting at the terrain's
 * height, so do NOT subtract the map centre's elevation as well. That buries the
 * ribbon by exactly that much, which at sea level looks almost right and in the
 * foothills puts it a hundred metres underground.
 */

/** Lifts the wall's foot just clear of the ground so the two cannot z-fight. */
const GROUND_LIFT_METERS = 1;
const BEACON_HEIGHT_METERS = 45;
/** Fades the band out by this size scale: from high up it only muddies the wall. */
const BAND_FADE_SCALE = 3;
/** Half the width of the flat band along the top of the wall, at flying zoom. */
const BAND_HALF_WIDTH_METERS = 3;
/**
 * Metre-sized shapes vanish when zoomed out to see the whole route, so they
 * grow with altitude at the rate the map shrinks: the same size on screen.
 */
const MAX_SIZE_SCALE = 40;

const WALL_VERTEX = /* glsl */ `
  attribute vec3 color;
  attribute float aAlong;
  attribute float aUp;
  attribute float aWall;
  attribute vec2 aSide;
  attribute float aBand;
  uniform float uSizeScale;
  varying float vBand;
  varying vec3 vColor;
  varying float vAlong;
  varying float vUp;
  void main() {
    vColor = color;
    vAlong = aAlong;
    vUp = aUp;
    vBand = aBand;
    vec3 p = position;
    p.z += aWall * uSizeScale;
    p.xy += aSide * uSizeScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const WALL_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uRiderMeters;
  uniform float uBandAlpha;
  varying float vBand;
  varying vec3 vColor;
  varying float vAlong;
  varying float vUp;
  void main() {
    // Fades into the ground, with a solid rim tracing the profile along the top.
    float rim = smoothstep(0.93, 0.98, vUp);
    float alpha = mix(0.12 + pow(vUp, 1.2) * 0.6, 1.0, rim);
    if (vBand > 0.5) alpha = uBandAlpha;
    // A soft band of light running ahead along the route every few hundred metres.
    float wave = mod(vAlong - uTime * 90.0, 400.0) / 400.0;
    float glint = smoothstep(0.9, 1.0, wave);
    // Lifted towards white so a flat, green stretch still stands out from a
    // green route line drawn on the road beneath it.
    vec3 color = mix(vColor, vec3(1.0), 0.28 * vBand) + glint * 0.5;
    // Road already ridden steps back so what is coming stands out.
    if (vAlong < uRiderMeters) {
      alpha *= 0.3;
      color = mix(color, vec3(dot(color, vec3(0.3, 0.6, 0.1))), 0.6);
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface ElevationLayer extends CustomLayerInterface {
  /**
   * `at` is where the rider is drawn. Not derivable from `meters`: the camera
   * path is smoothed through bends, so the two can sit ~60m apart on a tight
   * corner and the beacon would float away from the cyclist it marks.
   */
  setRider(at: LatLng, meters: number): void;
  setVisible(visible: boolean): void;
}

export function createElevationLayer(
  ribbon: ElevationRibbon,
  { initialRiderMeters = 0, visible = true }: { initialRiderMeters?: number; visible?: boolean } = {}
): ElevationLayer {
  const { points } = ribbon;
  const origin = MercatorCoordinate.fromLngLat([points[0].lng, points[0].lat]);
  const metre = origin.meterInMercatorCoordinateUnits();
  const local = (lat: number, lng: number) => {
    const m = MercatorCoordinate.fromLngLat([lng, lat]);
    // Negated to cancel the y-flip in the matrix below: three's y grows up
    // the screen where Mercator's grows down it.
    return { x: (m.x - origin.x) / metre, y: -(m.y - origin.y) / metre };
  };
  const groundZ = (elevation: number) => elevation * TERRAIN_EXAGGERATION + GROUND_LIFT_METERS;

  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);

  // Three strips sharing one buffer: the wall, and a flat band across its top.
  // The camera flies straight down the route, so the wall alone is edge-on and
  // all but invisible in flight; the band is what reads from behind, running
  // ahead down the street at the height and colour of the road to come.
  const STRIP_VERTS = 4;
  const positions = new Float32Array(points.length * STRIP_VERTS * 3);
  const colors = new Float32Array(points.length * STRIP_VERTS * 3);
  const along = new Float32Array(points.length * STRIP_VERTS);
  const up = new Float32Array(points.length * STRIP_VERTS);
  const wallHeight = new Float32Array(points.length * STRIP_VERTS);
  const side = new Float32Array(points.length * STRIP_VERTS * 2);
  const band = new Float32Array(points.length * STRIP_VERTS);
  const index: number[] = [];
  const locals = points.map((p) => local(p.lat, p.lng));
  points.forEach((p, i) => {
    const { x, y } = locals[i];
    const z = groundZ(p.elevation);
    // Direction over a few vertices: OSM's tiny jogs at junctions otherwise
    // swing the band's edges around into spikes.
    const a = locals[Math.max(0, i - 3)];
    const b = locals[Math.min(points.length - 1, i + 3)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * BAND_HALF_WIDTH_METERS;
    const ny = ((b.x - a.x) / len) * BAND_HALF_WIDTH_METERS;
    const base = i * STRIP_VERTS;
    for (let k = 0; k < STRIP_VERTS; k++) {
      positions.set([x, y, z], (base + k) * 3);
      colors.set(p.color, (base + k) * 3);
      along[base + k] = p.along;
    }
    // 0: wall foot. 1: wall top. 2 and 3: the band's two edges.
    up.set([0, 1, 1, 1], base);
    wallHeight.set([0, p.wallMeters, p.wallMeters, p.wallMeters], base);
    side.set([0, 0, 0, 0, nx, ny, -nx, -ny], base * 2);
    band.set([0, 0, 1, 1], base);
    if (i > 0) {
      const prev = base - STRIP_VERTS;
      index.push(prev, prev + 1, base, base, prev + 1, base + 1);
      index.push(prev + 2, prev + 3, base + 2, base + 2, prev + 3, base + 3);
    }
  });
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  wallGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  wallGeometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  wallGeometry.setAttribute("aUp", new THREE.BufferAttribute(up, 1));
  wallGeometry.setAttribute("aWall", new THREE.BufferAttribute(wallHeight, 1));
  wallGeometry.setAttribute("aSide", new THREE.BufferAttribute(side, 2));
  wallGeometry.setAttribute("aBand", new THREE.BufferAttribute(band, 1));
  wallGeometry.setIndex(index);
  const wallMaterial = new THREE.ShaderMaterial({
    vertexShader: WALL_VERTEX,
    fragmentShader: WALL_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uRiderMeters: { value: initialRiderMeters }, uSizeScale: { value: 1 }, uBandAlpha: { value: 1 } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  // The geometry spans the whole route and moves with the camera's elevation:
  // three's cached bounding sphere knows nothing about MapLibre's matrix.
  wall.frustumCulled = false;
  world.add(wall);

  // The rider's beacon: a column of light and a ring spreading on the ground.
  const beamGeometry = new THREE.CylinderGeometry(2.5, 2.5, BEACON_HEIGHT_METERS, 16, 1, true);
  beamGeometry.rotateX(Math.PI / 2);
  beamGeometry.translate(0, 0, BEACON_HEIGHT_METERS / 2);
  const beam = new THREE.Mesh(
    beamGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      // The rider is always visible, buildings or not: this is where you are.
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), ringMaterial);
  const beacon = new THREE.Group();
  beacon.add(beam, ring);
  beam.frustumCulled = false;
  ring.frustumCulled = false;
  world.add(beacon);

  let map: MlMap | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let riderMeters = initialRiderMeters;
  let riderAt: LatLng | null = null;
  let isVisible = visible;
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const startedAt = performance.now();

  const projection = new THREE.Matrix4();
  const originMatrix = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, 0)
    .scale(new THREE.Vector3(metre, -metre, metre));

  return {
    id: ELEVATION_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(m, gl) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      // MapLibre owns the frame: three must draw into it, not clear it.
      renderer.autoClear = false;
    },
    onRemove() {
      wallGeometry.dispose();
      wallMaterial.dispose();
      beamGeometry.dispose();
      (beam.material as THREE.Material).dispose();
      ring.geometry.dispose();
      ringMaterial.dispose();
      // Not forceContextLoss: this context is MapLibre's and is still in use.
      renderer?.dispose();
      renderer = null;
      map = null;
    },
    render(_gl, options: CustomRenderMethodInput) {
      if (!renderer || !map || !isVisible) return;
      const time = reducedMotion ? 0 : (performance.now() - startedAt) / 1000;
      wallMaterial.uniforms.uTime.value = time;
      wallMaterial.uniforms.uRiderMeters.value = riderMeters;

      const sizeScale = Math.min(MAX_SIZE_SCALE, Math.max(1, 2 ** (FLY_ZOOM - map.getZoom())));
      wallMaterial.uniforms.uSizeScale.value = sizeScale;
      wallMaterial.uniforms.uBandAlpha.value = Math.max(0, 1 - (sizeScale - 1) / (BAND_FADE_SCALE - 1)) * 0.95;

      const rider = ribbonAt(points, riderMeters);
      const at = local(riderAt?.lat ?? rider.lat, riderAt?.lng ?? rider.lng);
      beacon.position.set(at.x, at.y, groundZ(rider.elevation));
      const pulse = (time * 0.7) % 1;
      const radius = (6 + pulse * 26) * sizeScale;
      ring.scale.set(radius, radius, 1);
      beam.scale.set(sizeScale, sizeScale, sizeScale);
      ringMaterial.opacity = 0.65 * (1 - pulse);

      projection.fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]);
      camera.projectionMatrix.copy(projection).multiply(originMatrix);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    setRider(at: LatLng, meters: number) {
      riderAt = at;
      riderMeters = meters;
    },
    setVisible(v: boolean) {
      isVisible = v;
      map?.triggerRepaint();
    },
  };
}
