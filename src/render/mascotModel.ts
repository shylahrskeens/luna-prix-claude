/** The official Axie mascots as drivers.
 *
 *  Sky Mavis publishes seven mascots as self-contained GLB files — mesh,
 *  texture, skeleton and clips (Idle, Walk, Run, Greeting, Dead) in one file
 *  (github.com/jaatster/axie-3d-assets, limited-use rights for Vibeathon
 *  projects). Bing and Pomodoro are two of them, so those two drivers are the
 *  real characters. Loaded once each; every seat gets a skeleton-aware clone.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface MascotAsset {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

export interface MascotInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  action(name: string): THREE.AnimationAction | null;
}

export class MascotModelService {
  private loader = new GLTFLoader();
  private assets = new Map<string, Promise<MascotAsset | null>>();
  lastError: string | null = null;

  load(file: string): Promise<MascotAsset | null> {
    let p = this.assets.get(file);
    if (!p) {
      p = this.fetch(file).catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error(`[Axie mascot] ${file}: ${this.lastError}`);
        return null;
      });
      this.assets.set(file, p);
    }
    return p;
  }

  private async fetch(file: string): Promise<MascotAsset> {
    const gltf = await this.loader.loadAsync(file) as GLTF;
    const scene = gltf.scene;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      // The texture carries its shading; show it unlit so the mascot reads as
      // the artwork at full colour under any track's sun.
      const swap = (mat: THREE.Material): THREE.Material => {
        const src = mat as THREE.MeshStandardMaterial;
        const map = src.map ?? null;
        if (map) map.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshBasicMaterial({
          map, color: map ? 0xffffff : src.color, vertexColors: src.vertexColors,
          transparent: src.transparent, opacity: src.opacity, alphaTest: src.alphaTest, side: src.side,
          fog: false, toneMapped: false,
        });
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) clips.set(c.name, c);
    return { scene, clips };
  }

  instance(asset: MascotAsset): MascotInstance {
    const root = cloneSkeleton(asset.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const cache = new Map<string, THREE.AnimationAction>();
    const action = (name: string) => {
      const clip = asset.clips.get(name);
      if (!clip) return null;
      let a = cache.get(name);
      if (!a) { a = mixer.clipAction(clip); cache.set(name, a); }
      return a;
    };
    action('Idle')?.play();
    return { root, mixer, action };
  }
}
