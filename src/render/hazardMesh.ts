/** Hazard models, and the telegraph that makes them fair.
 *
 *  Every hazard in the game is a pure function of the race clock, so these
 *  meshes only ever read state — they never own it. The telegraph channel is
 *  the important one: a hazard that is about to become dangerous flashes
 *  before it does, which is the difference between a puzzle and a punishment.
 */
import * as THREE from 'three';
import type { HazardState, TrackRuntime } from '../sim/track';
import type { MaterialLibrary } from './scene';
import { clamp01 } from '../core/math';

export interface HazardVisual {
  group: THREE.Group;
  /** Parallel to the runtime's hazard list. */
  nodes: {
    root: THREE.Group;
    kind: string;
    /** Parts that pulse with the telegraph. */
    warn: THREE.Mesh[];
    /** Gate bars, which move with the opening. */
    barA?: THREE.Mesh;
    barB?: THREE.Mesh;
    span?: number;
  }[];
}

export function buildHazards(track: TrackRuntime, mats: MaterialLibrary): HazardVisual {
  const group = new THREE.Group();
  const nodes: HazardVisual['nodes'] = [];
  const theme = track.def.theme;
  const states = track.initHazards();

  for (const h of states) {
    const root = new THREE.Group();
    const warn: THREE.Mesh[] = [];
    let barA: THREE.Mesh | undefined;
    let barB: THREE.Mesh | undefined;
    const d = h.def;

    switch (d.kind) {
      case 'gator': {
        // Lower jaw, upper jaw, teeth and two eyes. Reads from a long way out.
        const skin = mats.toon('#4f7a46');
        const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), skin);
        lower.position.set(0, -0.35, 0.6);
        root.add(lower);
        const upper = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 3.8), skin);
        upper.position.set(0, 0.9, 0.4);
        upper.rotation.x = -0.42;
        root.add(upper);
        const toothGeo = new THREE.ConeGeometry(0.13, 0.46, 4);
        for (let i = 0; i < 8; i++) {
          const t = new THREE.Mesh(toothGeo, mats.toon('#f4f2e6'));
          const side = i < 4 ? -1 : 1;
          t.position.set(side * 0.82, 0.12, 0.0 + (i % 4) * 0.95);
          root.add(t);
        }
        for (const side of [-1, 1] as const) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.30, 7, 6), mats.glow('#ffd23f'));
          eye.position.set(side * 0.62, 1.32, -0.55);
          root.add(eye);
          warn.push(eye);
        }
        root.scale.setScalar(d.scale ?? 1);
        break;
      }
      case 'gate': {
        // Two bars with a gap between them that sweeps across the road.
        const mat = mats.toon('#8b7f6a');
        barA = new THREE.Mesh(new THREE.BoxGeometry(d.span, 4.2, 0.6), mat);
        barB = new THREE.Mesh(new THREE.BoxGeometry(d.span, 4.2, 0.6), mat);
        barA.position.y = 2.1;
        barB.position.y = 2.1;
        root.add(barA, barB);
        // A lintel so the gate reads as architecture.
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(d.span * 2.6, 1.1, 1.1), mats.toon(theme.rail));
        lintel.position.y = 4.8;
        root.add(lintel);
        for (const side of [-1, 1] as const) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.4, 1.1), mats.toon(theme.rail));
          post.position.set(side * d.span * 1.3, 2.7, 0);
          root.add(post);
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), mats.glow(theme.accent));
          lamp.position.set(side * d.span * 1.3, 5.6, 0);
          root.add(lamp);
          warn.push(lamp);
        }
        break;
      }
      case 'panel': {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.55, d.len), mats.toon('#7b8394'));
        root.add(panel);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.18, 0.4), mats.glow('#ff7a3d', 0.9));
        edge.position.set(0, 0.34, d.len * 0.5);
        root.add(edge);
        warn.push(edge);
        break;
      }
      case 'roller': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, 2.6, 8), mats.toon(theme.accent));
        body.rotation.z = Math.PI / 2;
        root.add(body);
        const core = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.55, 8, 6), mats.glow(theme.accent, 0.9));
        root.add(core);
        warn.push(core);
        break;
      }
      case 'turbine': {
        // Housing plus blades; the blades tell you which way the wind blows.
        const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.55, 6, 12), mats.toon(theme.rail));
        ring.position.y = 4.4;
        root.add(ring);
        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 0.9), mats.toon('#b7c2d4'));
          b.position.y = 1.9;
          const holder = new THREE.Group();
          holder.rotation.z = (i / 4) * Math.PI * 2;
          holder.add(b);
          blades.add(holder);
        }
        blades.position.y = 4.4;
        blades.name = 'blades';
        root.add(blades);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4), mats.glow(d.strength > 0 ? '#5fd8e8' : '#ff9d5c', 0.85));
        arrow.rotation.z = d.strength > 0 ? -Math.PI / 2 : Math.PI / 2;
        arrow.position.set(0, 1.0, 0);
        root.add(arrow);
        warn.push(arrow);
        break;
      }
      case 'bumper': {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.8, d.r, 1.6, 8), mats.toon('#c2472f'));
        post.position.y = 0.8;
        root.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.85, 8, 6), mats.glow('#ffd166', 0.9));
        cap.position.y = 1.7;
        root.add(cap);
        warn.push(cap);
        break;
      }
      case 'ring': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.42, 6, 18), mats.glow(theme.accent, 0.92));
        ring.position.y = d.h;
        root.add(ring);
        warn.push(ring);
        break;
      }
    }

    // Orient to the road and place at the anchor.
    root.position.set(h.anchor.x, h.anchor.y, h.anchor.z);
    root.rotation.y = Math.atan2(h.fwd.x, h.fwd.z);
    group.add(root);
    nodes.push({ root, kind: d.kind, warn, barA, barB, span: 'span' in d ? d.span : undefined });
  }

  return { group, nodes };
}

export function updateHazards(v: HazardVisual, states: HazardState[], time: number): void {
  for (let i = 0; i < v.nodes.length; i++) {
    const n = v.nodes[i];
    const h = states[i];
    if (!h) continue;
    n.root.position.set(h.pos.x, h.pos.y, h.pos.z);

    // The telegraph: warning parts pulse harder the closer the strike is.
    const flash = h.telegraph > 0
      ? 0.55 + 0.45 * Math.sin(time * (8 + h.telegraph * 22))
      : 0.35;
    for (const w of n.warn) {
      const m = w.material as THREE.MeshBasicMaterial;
      if (m.opacity !== undefined) m.opacity = clamp01(flash);
      w.scale.setScalar(1 + h.telegraph * 0.28 * flash);
    }

    switch (n.kind) {
      case 'gator': {
        // Rise, open the jaws at the top of the arc, sink back.
        const open = clamp01(h.active ? 1 : h.telegraph * 0.35);
        n.root.children.forEach((c) => {
          if (c instanceof THREE.Mesh && c.geometry instanceof THREE.BoxGeometry && c.position.y > 0.5) {
            c.rotation.x = -0.42 - open * 0.75;
          }
        });
        break;
      }
      case 'gate': {
        if (n.barA && n.barB && n.span !== undefined) {
          const centre = Math.sin(h.phase * Math.PI * 2) * n.span * 0.62;
          const half = n.span * 0.40;
          // Bars sit either side of the opening, so the gap is always visible.
          n.barA.position.x = centre - half - n.span * 0.5;
          n.barB.position.x = centre + half + n.span * 0.5;
        }
        break;
      }
      case 'turbine': {
        const blades = n.root.getObjectByName('blades');
        if (blades) blades.rotation.z = time * 3.2;
        break;
      }
      case 'ring': {
        n.root.rotation.z = time * 0.6;
        break;
      }
      case 'panel': {
        // Tilt as it falls away so the drop is legible from the approach.
        n.root.rotation.x = h.active ? Math.min(0.9, (h.phase - 0.55) * 4) : 0;
        break;
      }
    }
  }
}
