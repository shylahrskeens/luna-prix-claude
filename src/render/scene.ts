/** Renderer, lighting, sky and the shared toon material factory.
 *
 *  The look is flat-shaded low poly with a three-step toon ramp: cheap enough
 *  to hold frame rate with a full field and enough VFX, and readable enough
 *  that a hazard never hides in a gradient.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AxieMixerService } from './axieMixer';
import { StarterModelService } from './starterModel';
import type { TrackTheme } from '../sim/trackTypes';

/** Three-step ramp. Sampling it as a 1D texture is what turns a smooth Lambert
 *  falloff into banded cel shading. */
function toonGradient(steps = 3): THREE.DataTexture {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // Keep the darkest band well above black so shadowed geometry still reads.
    const v = Math.round(255 * (0.46 + 0.54 * (i / (steps - 1))));
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class MaterialLibrary {
  readonly gradient = toonGradient();
  /** Studio reflection for painted and chrome parts; set by the RenderContext. */
  envMap: THREE.Texture | null = null;
  private cache = new Map<string, THREE.Material>();

  /** Flat-shaded toon material. Cached by colour so the whole scene shares a
   *  handful of materials and batches well. */
  toon(color: THREE.ColorRepresentation, opts: { flat?: boolean; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
    const key = `t|${new THREE.Color(color).getHexString()}|${opts.flat !== false}|${opts.opacity ?? 1}`;
    const hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshToonMaterial;
    const m = new THREE.MeshToonMaterial({
      color,
      gradientMap: this.gradient,
      transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1),
      opacity: opts.opacity ?? 1,
    });
    // three renders flat shading for any material whose `flatShading` is true;
    // MeshToonMaterialParameters just does not declare it in the typings.
    (m as unknown as { flatShading: boolean }).flatShading = opts.flat !== false;
    this.cache.set(key, m);
    return m;
  }

  /** Painted bodywork: physically shaded, lit by the environment map, so a
   *  kart carries highlights and a soft reflection instead of a flat fill. */
  paint(color: THREE.ColorRepresentation, opts: { roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
    const key = `p|${new THREE.Color(color).getHexString()}|${opts.roughness ?? 0.38}|${opts.metalness ?? 0.18}`;
    const hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.38, metalness: opts.metalness ?? 0.18,
      envMap: this.envMap, envMapIntensity: 0.55,
    });
    this.cache.set(key, m);
    return m;
  }

  /** Bright metal: exhaust tips, spokes, bumper bars, rails. */
  chrome(color: THREE.ColorRepresentation = '#cfd6e0'): THREE.MeshStandardMaterial {
    return this.paint(color, { roughness: 0.22, metalness: 0.92 });
  }

  /** A painted decal — number roundels, plates. One material per texture. */
  decal(map: THREE.Texture): THREE.MeshStandardMaterial {
    const key = `d|${map.uuid}`;
    const hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.05, transparent: true, polygonOffset: true, polygonOffsetFactor: -1, envMap: this.envMap, envMapIntensity: 0.3 });
    this.cache.set(key, m);
    return m;
  }

  /** Unlit material for emissive elements — boost pads, ring gates, lights. */
  glow(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
    const key = `g|${new THREE.Color(color).getHexString()}|${opacity}`;
    const hit = this.cache.get(key);
    if (hit) return hit as THREE.MeshBasicMaterial;
    const m = new THREE.MeshBasicMaterial({
      color, transparent: opacity < 1, opacity, toneMapped: false,
      depthWrite: opacity >= 1,
    });
    this.cache.set(key, m);
    return m;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.gradient.dispose();
  }
}

/** Vertical gradient sky. A single inverted sphere with a shader that blends
 *  two theme colours and lifts a warm band toward the sun. */
function makeSky(theme: TrackTheme): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky[0]) },
      bottom: { value: new THREE.Color(theme.sky[1]) },
      sunDir: { value: new THREE.Vector3(...theme.sunDir).normalize() },
      sunColor: { value: new THREE.Color(theme.sun) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottom, top, pow(h, 0.75));
        // Broad warm bloom around the sun, plus a small hot core.
        float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += sunColor * pow(d, 6.0) * 0.30;
        col += sunColor * pow(d, 220.0) * 0.9;
        //  Encode to sRGB by hand.
        //
        //  three converts colours to linear working space on the way in, and
        //  normally converts back on the way out — but only for materials
        //  built from its own shader chunks. A raw ShaderMaterial writing
        //  gl_FragColor directly skips that, so the sky was being written as
        //  linear values into an sRGB buffer and came out several stops dark.
        col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

export type QualityTier = 'low' | 'medium' | 'high';

export interface SceneQuality {
  tier: QualityTier;
  pixelRatio: number;
  sceneryDensity: number;
  particleBudget: number;
  drawDistance: number;
}

export const QUALITY: Record<QualityTier, Omit<SceneQuality, 'pixelRatio'>> = {
  low:    { tier: 'low',    sceneryDensity: 0.35, particleBudget: 140, drawDistance: 420 },
  medium: { tier: 'medium', sceneryDensity: 0.70, particleBudget: 320, drawDistance: 700 },
  high:   { tier: 'high',   sceneryDensity: 1.00, particleBudget: 600, drawDistance: 1100 },
};

export class RenderContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly materials = new MaterialLibrary();
  /** Sky Mavis Mixer 3D, booted on the first seat that asks for it. */
  readonly mixer: AxieMixerService;
  /** The three official starter Axies, loaded on first seat. */
  readonly starters = new StarterModelService();
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  quality: SceneQuality;
  private sky: THREE.Mesh | null = null;
  private fog = new THREE.Fog(0x808080, 50, 500);

  constructor(canvas: HTMLCanvasElement, tier: QualityTier = 'high') {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x0b0d12, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mixer = new AxieMixerService(this.renderer);
    this.mixer.quality = tier === 'low' ? 'performance' : 'balanced';
    this.quality = { ...QUALITY[tier], pixelRatio: Math.min(window.devicePixelRatio, tier === 'high' ? 2 : 1.25) };
    this.renderer.setPixelRatio(this.quality.pixelRatio);

    this.camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.3, 5000);
    this.scene.fog = this.fog;

    // Three's lights are physical since r155: a directional light at 2.1 plus
    // a hemisphere at 1.25 multiplies every surface colour by well over three,
    // which turns a grey-brown road into cream and flattens the whole palette.
    // These two numbers sum to a little over 1, so a material renders close to
    // the colour it was authored as.
    this.sun = new THREE.DirectionalLight(0xffffff, 1.05);
    this.sun.position.set(80, 140, 60);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambient = new THREE.HemisphereLight(0xffffff, 0x404050, 0.42);
    this.scene.add(this.ambient);

    // A neutral studio environment for the physically shaded kart materials.
    // It goes on those materials directly, never on scene.environment: three
    // multiplies every MeshBasicMaterial by a scene environment too, and that
    // turned the boost pads, the start line and every glow into dark slabs.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.materials.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  applyTheme(theme: TrackTheme): void {
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      (this.sky.material as THREE.Material).dispose();
    }
    this.sky = makeSky(theme);
    this.scene.add(this.sky);

    this.fog.color.set(theme.fog);
    this.fog.near = theme.fogNear;
    this.fog.far = Math.min(theme.fogFar, this.quality.drawDistance);
    this.renderer.setClearColor(new THREE.Color(theme.fog), 1);

    const d = new THREE.Vector3(...theme.sunDir).normalize();
    this.sunDir.copy(d);
    this.sun.position.copy(d).multiplyScalar(300);
    this.sun.color.set(theme.sun);
    this.ambient.color.set(theme.sun);
    this.ambient.groundColor.set(theme.ambient);
  }

  setQuality(tier: QualityTier): void {
    this.quality = { ...QUALITY[tier], pixelRatio: Math.min(window.devicePixelRatio, tier === 'high' ? 2 : 1.25) };
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.fog.far = Math.min(this.fog.far, this.quality.drawDistance);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Keep the sky centred on the camera so it never clips. */
  render(): void {
    if (this.sky) this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Keep the directional light anchored to the action so its direction stays
   *  constant across a kilometre of track. */
  followSun(x: number, y: number, z: number): void {
    const dir = this.sunDir;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + dir.x * 300, y + dir.y * 300, z + dir.z * 300);
  }
  private sunDir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();

  dispose(): void {
    this.materials.dispose();
    this.renderer.dispose();
  }
}

/** Dispose an entire subtree's geometry (materials are shared and owned by the
 *  material library, so they are deliberately left alone). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  root.clear();
}
