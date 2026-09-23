/** The official starter Axies — Buba, Puffy and Pomodoro — as drivers.
 *
 *  Sky Mavis publishes these three as rigged, textured GLB files with a clip
 *  per file (github.com/axieinfinity/axie-starter-3d-assets). They are the
 *  characters the game's three drivers are named for, so the driver on the
 *  kart is the actual Axie, not a build assembled to resemble one. The Mixer
 *  path stays for any Axie that arrives as genes.
 *
 *  One load per Axie; each seat gets a skeleton-aware clone so eight karts
 *  share geometry and textures but animate independently.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type StarterId = 'buba' | 'puffy' | 'pomodoro';
export const STARTER_CLIPS = ['idle', 'run', 'idlegethit', 'jump'] as const;
export type StarterClip = typeof STARTER_CLIPS[number];

export interface StarterAsset {
  scene: THREE.Group;
  clips: Record<StarterClip, THREE.AnimationClip>;
}

export interface StarterInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<StarterClip, THREE.AnimationAction>;
}

const BASE = 'axies/';

export class StarterModelService {
  private loader = new GLTFLoader();
  private assets = new Map<StarterId, Promise<StarterAsset | null>>();
  lastError: string | null = null;

  /** Load (once) the model and its clips. Resolves null when unavailable. */
  load(id: StarterId): Promise<StarterAsset | null> {
    let p = this.assets.get(id);
    if (!p) {
      p = this.fetch(id).catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error(`[Starter Axie] ${id}: ${this.lastError}`);
        return null;
      });
      this.assets.set(id, p);
    }
    return p;
  }

  private async fetch(id: StarterId): Promise<StarterAsset> {
    const files = await Promise.all(
      STARTER_CLIPS.map((c) => this.loader.loadAsync(`${BASE}${id}/${c}.glb`) as Promise<GLTF>),
    );
    const clips = {} as Record<StarterClip, THREE.AnimationClip>;
    STARTER_CLIPS.forEach((c, i) => {
      const clip = files[i].animations[0];
      if (!clip) throw new Error(`${c}.glb carries no animation clip`);
      clip.name = c;
      clips[c] = clip;
    });
    const scene = files[0].scene;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        // The textures are painted with their shading baked in, so they are
        // shown unlit: the Axie reads as the artwork it is, at full colour,
        // instead of a grey version of itself under the track's dim sun.
        const swap = (mat: THREE.Material): THREE.Material => {
          const src = mat as THREE.MeshStandardMaterial;
          const map = src.map ?? null;
          if (map) map.colorSpace = THREE.SRGBColorSpace;
          const out = new THREE.MeshBasicMaterial({
            map, color: map ? 0xffffff : src.color, vertexColors: src.vertexColors,
            transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side,
            fog: false, toneMapped: false,
          });
          out.name = src.name;
          return out;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      }
    });
    return { scene, clips };
  }

  /** A fresh animated instance of a loaded asset. */
  instance(asset: StarterAsset): StarterInstance {
    const root = cloneSkeleton(asset.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const actions = {} as Record<StarterClip, THREE.AnimationAction>;
    for (const c of STARTER_CLIPS) {
      const a = mixer.clipAction(asset.clips[c]);
      if (c === 'idlegethit' || c === 'jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
      actions[c] = a;
    }
    actions.idle.play();
    return { root, mixer, actions };
  }
}
