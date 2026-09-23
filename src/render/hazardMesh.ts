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
      case 'chest': {
        // A wooden loot chest with gold bands and a glowing keyhole, floating
        // and turning so it reads as a pickup from a long way off.
        const wood = mats.toon('#a5673f');
        const gold = mats.toon('#f0c24a');
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.0), wood);
        root.add(body);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10, 1, false, 0, Math.PI), wood);
        lid.rotation.z = Math.PI / 2; lid.position.y = 0.45;
        root.add(lid);
        for (const x of [-0.5, 0.5]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.94, 1.04), gold);
          band.position.x = x; root.add(band);
          const bandLid = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 12, Math.PI), gold);
          bandLid.position.set(x, 0.45, 0); bandLid.rotation.y = Math.PI / 2; root.add(bandLid);
        }
        const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.12), mats.glow('#ffe58a', 1));
        lock.position.set(0, 0.1, 0.52); root.add(lock);
        warn.push(lock);
        break;
      }
      case 'boss': {
        // The land's boss stands off the road; the fist is a child group that
        // the animator raises and slams. Built from chunky primitives in the
        // Origins manner, with the key colours of each boss.
        const S = 1.0;
        const figure = new THREE.Group();
        figure.name = 'boss-figure';
        const fist = new THREE.Group();
        fist.name = 'boss-fist';
        // The figure stands at the anchor (lat), the fist comes down at slamLat.
        const towardRoad = d.slamLat - d.lat;
        if (d.style === 'chimera') {
          // Pink hooded beast: green body, wide toothy mouth, pink hood with ears.
          const body = new THREE.Mesh(new THREE.SphereGeometry(3.2 * S, 10, 8), mats.toon('#7fa63a'));
          body.position.y = 4.2; body.scale.set(1, 1.1, 0.9); figure.add(body);
          const hood = new THREE.Mesh(new THREE.SphereGeometry(3.6 * S, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.toon('#f26a9a'));
          hood.position.y = 5.2; figure.add(hood);
          for (const side of [-1, 1] as const) {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 5), mats.toon('#f26a9a'));
            ear.position.set(side * 2.2, 8.6, 0); ear.rotation.z = -side * 0.25; figure.add(ear);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.4, 6), mats.toon('#5a6a2a'));
            leg.position.set(side * 1.4, 1.2, 0); figure.add(leg);
          }
          const mouth = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 1.2), mats.toon('#2a1a1a'));
          mouth.position.set(0, 3.6, 2.6); figure.add(mouth);
          for (let i = 0; i < 6; i++) {
            const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 4), mats.toon('#fff6e3'));
            tooth.position.set(-1.8 + i * 0.72, 4.3, 3.1); tooth.rotation.x = Math.PI; figure.add(tooth);
          }
          const nose = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), mats.toon('#3f6fd0'));
          nose.position.set(0, 5.4, 3.3); figure.add(nose);
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 5.5, 6), mats.toon('#7fa63a'));
          arm.rotation.z = Math.PI / 2; arm.position.set(towardRoad * 0.45, 0.8, 0); fist.add(arm);
          const hand = new THREE.Mesh(new THREE.SphereGeometry(d.reach * 0.9, 8, 6), mats.toon('#6a4a2a'));
          hand.position.set(towardRoad, 0.6, 0); fist.add(hand);
        } else if (d.style === 'ent') {
          // Tree golem: bark body, long arms, a crown of leaves.
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 8, 7), mats.toon('#7a5236'));
          trunk.position.y = 4; figure.add(trunk);
          const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 1), mats.toon('#8fd06c'));
          crown.position.y = 9.4; figure.add(crown);
          const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), mats.toon('#b4e07a'));
          crown2.position.set(0.8, 11.2, 0.4); figure.add(crown2);
          for (const side of [-1, 1] as const) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mats.glow('#ffd23f'));
            eye.position.set(side * 0.7, 6.8, 1.7); figure.add(eye);
            const root2 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 2.0, 5), mats.toon('#6a4a30'));
            root2.position.set(side * 1.6, 0.9, 0.4); root2.rotation.z = side * 0.4; figure.add(root2);
          }
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 7, 6), mats.toon('#7a5236'));
          arm.rotation.z = Math.PI / 2; arm.position.set(towardRoad * 0.5, 0.9, 0); fist.add(arm);
          const hand = new THREE.Mesh(new THREE.DodecahedronGeometry(d.reach * 0.85, 0), mats.toon('#8a5a36'));
          hand.position.set(towardRoad, 0.7, 0); fist.add(hand);
        } else {
          // Kilnbane: a golden pot golem with a blue-crystal finial, mossy
          // shoulders, a fanged clay grin, and blue clay arms.
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.6, 6.5, 10), mats.toon('#d9b56a'));
          pot.position.y = 3.6; figure.add(pot);
          const lid = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.0, 1.4, 10), mats.toon('#e6c886'));
          lid.position.y = 7.4; figure.add(lid);
          const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), mats.glow('#3f8fe0', 1));
          finial.position.y = 9.0; figure.add(finial);
          const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), mats.toon('#7fb84a'));
          moss.position.set(-2.2, 6.6, 0.8); figure.add(moss);
          const grin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 0.6), mats.toon('#3a2a1a'));
          grin.position.set(0, 3.2, 3.4); figure.add(grin);
          for (let i = 0; i < 4; i++) {
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 4), mats.toon('#fff6e3'));
            fang.position.set(-1.2 + i * 0.8, 2.8, 3.6); figure.add(fang);
          }
          for (const side of [-1, 1] as const) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), mats.glow('#ff8a3f'));
            eye.position.set(side * 1.1, 4.8, 3.3); figure.add(eye);
            const foot = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 2.2), mats.toon('#7fa0c8'));
            foot.position.set(side * 2.0, 0.5, 0.4); figure.add(foot);
          }
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 5.5, 8), mats.toon('#7fa0c8'));
          arm.rotation.z = Math.PI / 2; arm.position.set(towardRoad * 0.45, 0.9, 0); fist.add(arm);
          const hand = new THREE.Mesh(new THREE.BoxGeometry(d.reach * 1.6, d.reach * 1.2, d.reach * 1.6), mats.toon('#6f8fb8'));
          hand.position.set(towardRoad, 0.6, 0); fist.add(hand);
        }
        // A slam mark on the road where the fist lands, which pulses as a warning.
        const mark = new THREE.Mesh(new THREE.RingGeometry(d.reach * 0.6, d.reach * 1.05, 20), mats.glow('#ff5a3f', 0.8));
        mark.rotation.x = -Math.PI / 2; mark.position.set(towardRoad, 0.08, 0);
        warn.push(mark);
        figure.add(fist);
        figure.add(mark);
        figure.rotation.y = Math.atan2(h.right.x, h.right.z) + (towardRoad < 0 ? Math.PI : 0) + Math.PI / 2;
        root.add(figure);
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
        // A round thing you bounce off, drawn as the land would have it: an
        // ochre boulder on the savannah, a mossy rock in the forest, a snow
        // boulder in the arctic, a crystal cluster in the mystic ruins. (It
        // used to be a red post with a glowing dome — a light bulb, in effect.)
        const land = theme.scenery;
        const rockColor = land === 'savannah' ? '#c9955f' : land === 'arctic' ? '#e8f2fb' : land === 'mystic' ? '#8a6ab8' : '#7f8a72';
        const rockMat = mats.toon(rockColor);
        const big = new THREE.Mesh(new THREE.DodecahedronGeometry(d.r * 0.95, 0), rockMat);
        big.position.y = d.r * 0.75; big.rotation.set(0.3, 0.6, 0.1);
        root.add(big);
        const small = new THREE.Mesh(new THREE.DodecahedronGeometry(d.r * 0.55, 0), mats.toon(land === 'arctic' ? '#cfe3f5' : land === 'mystic' ? '#a98be0' : '#a07f56'));
        small.position.set(d.r * 0.7, d.r * 0.4, d.r * 0.3); small.rotation.set(0.8, 0.2, 0.5);
        root.add(small);
        if (land === 'mystic') {
          for (let i = 0; i < 3; i++) {
            const shard = new THREE.Mesh(new THREE.OctahedronGeometry(d.r * 0.45, 0), mats.glow(theme.accent, 0.9));
            shard.position.set((i - 1) * d.r * 0.5, d.r * 1.5 + (i % 2) * 0.3, 0); shard.rotation.z = (i - 1) * 0.35;
            root.add(shard);
          }
        } else if (land === 'forest' || land === 'canopy') {
          const moss = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.6, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.toon('#6fb85a'));
          moss.position.set(-d.r * 0.2, d.r * 1.3, 0.1);
          root.add(moss);
        } else if (land === 'arctic') {
          const snow = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.7, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.toon('#ffffff'));
          snow.position.set(0, d.r * 1.25, 0);
          root.add(snow);
        }
        break;
      }
      case 'ring': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.42, 6, 18), mats.glow(theme.accent, 0.92));
        ring.position.y = d.h;
        ring.name = 'ringBand';
        root.add(ring);
        warn.push(ring);
        // Four posts of light so the ring reads as a gate from a distance and
        // you can judge its height against the ground.
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mats.glow('#ffffff', 0.8));
          post.position.set(Math.cos(a) * d.r, d.h + Math.sin(a) * d.r, 0);
          root.add(post);
        }
        break;
      }
      case 'stack': {
        //  Three silhouettes, so a row of obstacles reads as a row of
        //  different things rather than one shape repeated.
        const style = d.style ?? 'crates';
        if (style === 'bus') {
          const body = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h * 0.78, d.len), mats.toon('#e8a33d'));
          body.position.y = d.h * 0.5;
          root.add(body);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(d.w * 0.86, d.h * 0.22, d.len * 0.9), mats.toon('#f2c46a'));
          roof.position.y = d.h * 0.96;
          root.add(roof);
          for (let i = -1; i <= 1; i += 2) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.1, d.h * 0.24, d.len * 0.7), mats.toon('#2a3444'));
            win.position.set(0, d.h * 0.62, i * 0.01);
            root.add(win);
          }
        } else if (style === 'gator') {
          const skin = mats.toon('#4f7a46');
          const body = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h * 0.62, d.len), skin);
          body.position.y = d.h * 0.4;
          root.add(body);
          const head = new THREE.Mesh(new THREE.BoxGeometry(d.w * 0.8, d.h * 0.5, d.len * 0.4), skin);
          head.position.set(0, d.h * 0.7, d.len * 0.4);
          root.add(head);
          for (const side of [-1, 1] as const) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), mats.glow('#ffd23f'));
            eye.position.set(side * d.w * 0.26, d.h * 1.0, d.len * 0.36);
            root.add(eye);
            warn.push(eye);
          }
          const toothGeo = new THREE.ConeGeometry(0.16, 0.5, 4);
          for (let i = 0; i < 6; i++) {
            const t = new THREE.Mesh(toothGeo, mats.toon('#f4f2e6'));
            t.position.set((i % 3 - 1) * d.w * 0.28, d.h * 0.5, d.len * (i < 3 ? 0.56 : 0.48));
            root.add(t);
          }
        } else if (style === 'logs') {
          // A pile of fallen trunks, stacked in a pyramid across the road.
          const bark = mats.toon('#5a3d26');
          const end = mats.toon('#c9a271');
          const n = Math.max(2, Math.round(d.w / 0.7));
          const r = Math.min(0.42, d.h / 3.2);
          for (let row = 0; row < 3; row++) {
            for (let i = 0; i < n - row; i++) {
              const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.len + 0.6, 9), bark);
              log.rotation.x = Math.PI / 2;
              log.position.set((i - (n - row - 1) / 2) * r * 2.05, r + row * r * 1.75, (row % 2) * 0.2 - 0.1);
              log.rotation.z = (i % 2 ? 1 : -1) * 0.04;
              root.add(log);
              for (const zz of [-1, 1] as const) {
                const cap = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 9), end);
                cap.position.set(log.position.x, log.position.y, log.position.z + zz * (d.len * 0.5 + 0.31));
                cap.rotation.y = zz > 0 ? 0 : Math.PI;
                root.add(cap);
              }
            }
          }
        } else if (style === 'drums') {
          // Fallen column drums: fluted stone cylinders on their sides.
          const stone = mats.toon('#9b8f7c');
          const dark = mats.toon('#6e6455');
          const n = Math.max(1, Math.round(d.w / 1.1));
          for (let i = 0; i < n; i++) {
            const R = Math.min(0.55, d.h * 0.42);
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, d.len * 0.9, 12), stone);
            drum.rotation.x = Math.PI / 2;
            drum.rotation.z = (i % 2 ? 1 : -1) * 0.15;
            drum.position.set((i - (n - 1) / 2) * R * 2.1, R, (i % 2) * 0.3 - 0.15);
            root.add(drum);
            for (let f = 0; f < 6; f++) {
              const flute = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, d.len * 0.86), dark);
              const a = (f / 6) * Math.PI * 2;
              flute.position.set(drum.position.x + Math.cos(a) * R * 0.98, R + Math.sin(a) * R * 0.98, drum.position.z);
              flute.rotation.z = a;
              root.add(flute);
            }
          }
          const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, d.len * 0.8, 12), stone);
          top.rotation.x = Math.PI / 2;
          top.position.set(0, Math.min(d.h - 0.5, 1.55), 0);
          root.add(top);
        } else if (style === 'boulders') {
          // Ochre boulders in a heap.
          const rock = mats.toon('#b98a5a');
          const dark = mats.toon('#8f6a42');
          const n = Math.max(2, Math.round(d.w / 0.9));
          for (let i = 0; i < n + 1; i++) {
            const R = Math.min(0.75, d.h * 0.5) * (i === n ? 0.8 : 1);
            const b = new THREE.Mesh(new THREE.DodecahedronGeometry(R, 0), i % 2 ? dark : rock);
            b.position.set(i === n ? 0 : (i - (n - 1) / 2) * R * 1.7, i === n ? R * 2.4 : R * 0.9, (i % 2) * 0.35 - 0.15);
            b.rotation.set(i * 0.7, i * 1.3, 0);
            root.add(b);
          }
        } else if (style === 'cargo') {
          // Dock cargo: steel crates with rivet strips and a warning stripe.
          const steel = mats.toon('#5d6f88');
          const strip = mats.toon('#2c3441');
          const stripe = mats.glow('#ffb23f', 1);
          const n = Math.max(1, Math.round(d.w / 1.2));
          for (let i = 0; i < n; i++) {
            const box = new THREE.Mesh(new THREE.BoxGeometry(d.w / n * 0.94, d.h * 0.95, d.len * 0.94), steel);
            box.position.set((i - (n - 1) / 2) * (d.w / n), d.h * 0.48, 0);
            root.add(box);
            for (const y of [0.25, 0.75]) {
              const band = new THREE.Mesh(new THREE.BoxGeometry(d.w / n * 0.96, 0.08, d.len * 0.96), strip);
              band.position.set(box.position.x, d.h * y, 0);
              root.add(band);
            }
            const tape = new THREE.Mesh(new THREE.BoxGeometry(d.w / n * 0.5, 0.12, 0.02), stripe);
            tape.position.set(box.position.x, d.h * 0.5, d.len * 0.48);
            root.add(tape);
          }
        } else {
          const rows = Math.max(1, Math.round(d.h / 1.3));
          for (let r2 = 0; r2 < rows; r2++) {
            const n = Math.max(1, rows - r2);
            for (let c = 0; c < n; c++) {
              const crate = new THREE.Mesh(
                new THREE.BoxGeometry(d.w / rows * 0.92, 1.2, d.len * 0.9),
                mats.toon(c % 2 ? '#a9733c' : '#8d5f30'),
              );
              crate.position.set((c - (n - 1) / 2) * (d.w / rows), 0.6 + r2 * 1.25, 0);
              root.add(crate);
            }
          }
        }
        // A striped board at the near face of a jump obstacle, so the thing you
        // must clear has an edge you can judge from the air. Race-track props
        // (logs, drums, cargo) are driven around, not over, and carry none.
        if (style === 'crates' || style === 'bus' || style === 'gator') {
          const face = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.6, 0.25), mats.glow('#ffd166', 0.9));
          face.position.set(0, d.h + 0.4, d.len * 0.5);
          root.add(face);
          warn.push(face);
        }
        break;
      }
      case 'target': {
        //  Concentric rings on the ground. Painted flat and unlit so the
        //  colours read the same from a hundred metres up as from the edge.
        const palette = ['#2f3a4c', '#c07a3e', '#c7ced8', '#ffd23f'];
        d.rings.forEach((radius, i) => {
          const inner = d.rings[i + 1] ?? 0;
          const ringMesh = new THREE.Mesh(
            new THREE.RingGeometry(inner, radius, 40),
            mats.glow(palette[Math.min(palette.length - 1, i)], 0.8),
          );
          ringMesh.rotation.x = -Math.PI / 2;
          ringMesh.position.y = 0.06 + i * 0.01;
          ringMesh.renderOrder = 2 + i;
          root.add(ringMesh);
        });
        // Corner posts: the target has to be findable while you are in the air
        // and looking at it edge-on.
        const outer = d.rings[0] ?? 8;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 0.4), mats.toon('#2b2f3a'));
          post.position.set(Math.cos(a) * outer * 1.25, 2.75, Math.sin(a) * outer * 1.25);
          root.add(post);
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mats.glow('#ffd23f'));
          lamp.position.set(Math.cos(a) * outer * 1.25, 5.8, Math.sin(a) * outer * 1.25);
          root.add(lamp);
          warn.push(lamp);
        }
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
    if (n.kind === 'boss') n.root.position.set(h.anchor.x, h.anchor.y, h.anchor.z);
    else n.root.position.set(h.pos.x, h.pos.y, h.pos.z);

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
      case 'chest': {
        n.root.rotation.y = h.phase * Math.PI * 2;
        break;
      }
      case 'boss': {
        // Wind up (rise, lean back), slam (drop), hold, lift.
        const t = h.phase;
        const fist = n.root.getObjectByName('boss-fist');
        if (fist) {
          const lift = t < 0.45 ? 0.3 + t * 2 : t < 0.62 ? 1.2 + (t - 0.45) / 0.17 * 6.0 : t < 0.74 ? 0 : (t - 0.74) / 0.26 * 0.3;
          fist.position.y = lift;
          fist.rotation.x = t >= 0.45 && t < 0.62 ? -(t - 0.45) / 0.17 * 0.5 : 0;
        }
        const fig = n.root.getObjectByName('boss-figure');
        if (fig) fig.position.y = h.active ? -0.25 : 0;
        break;
      }
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
