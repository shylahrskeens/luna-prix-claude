/** The driver seat contract.
 *
 *  A kart does not care what is sitting in it. It owns a DriverRig: a root to
 *  parent at the seat socket, an update fed the same AxieDriveState every
 *  frame, and a dispose. Two things implement it — the procedural Axie built
 *  from geometry (always available, instant) and a Sky Mavis Mixer 3D
 *  character (real Axie body and parts, loaded asynchronously). The kart is
 *  seated with the procedural rig first and upgraded in place when the Mixer
 *  character arrives, so a slow or missing asset pack costs nothing but looks.
 */
import * as THREE from 'three';
import type { AxiePlayableCharacter } from '@jaatster/threejs-axie-mixer3d-public';
import { updateAxie, type AxieDriveState, type AxieRig } from './axieMesh';
import type { AxieDefinition } from '../data/axies';
import type { StarterInstance } from './starterModel';
import { clamp01, damp } from '../core/math';

export interface DriverRig {
  readonly kind: 'procedural' | 'mixer' | 'starter';
  readonly root: THREE.Group;
  update(s: AxieDriveState): void;
  dispose(): void;
}

export function proceduralDriver(rig: AxieRig, def: AxieDefinition): DriverRig {
  rig.root.position.set(...def.rig.seatOffset);
  rig.root.rotation.x = def.rig.seatPitch;
  return {
    kind: 'procedural',
    root: rig.root,
    update: (s) => updateAxie(rig, s),
    dispose: () => {
      rig.root.removeFromParent();
      rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };
}

/** The Mixer character stands with its feet at y = 0, in metres, about 1.2 m
 *  tall, and in this scene it faces +Z as assembled — the same way the kart
 *  drives — so it is not turned. (The first cut turned it a half-circle on
 *  the strength of the pack's "forward -Z" note, and every driver rode
 *  backwards, grinning at the chase camera.) It is scaled to the seat, and
 *  the same lean / crouch / cheer language the procedural rig speaks is
 *  applied to a group above it, on top of the Axie's own animation. */
export function mixerDriver(character: AxiePlayableCharacter, def: AxieDefinition): DriverRig {
  const seat = def.mixerSeat;
  const root = new THREE.Group();
  root.name = `MixerDriver:${def.id}`;
  const pose = new THREE.Group();
  pose.position.set(...seat.offset);
  pose.rotation.set(seat.pitch, 0, 0);
  pose.scale.setScalar(seat.scale);
  pose.add(character.wrapper);
  root.add(pose);

  const a = { lean: 0, crouch: 0, cheer: 0, flinch: 0, t: 0, lastImpact: 0, stunned: false };
  let disposed = false;

  return {
    kind: 'mixer',
    root,
    update(s) {
      if (disposed) return;
      const dt = Math.min(s.dt, 0.05);
      a.t += dt;
      const fast = clamp01(s.speed / Math.max(8, s.topSpeed));

      const steerLean = s.steer * 0.22;
      const driftLean = s.drifting ? s.driftDir * 0.34 : 0;
      a.lean = damp(a.lean, (steerLean + driftLean) * (0.4 + 0.6 * fast), 9, dt);
      a.crouch = damp(a.crouch, fast * 0.10 + (s.boosting ? 0.07 : 0) + s.compression * 0.16, 11, dt);
      a.flinch = Math.max(damp(a.flinch, 0, 5, dt), s.impact);
      a.cheer = damp(a.cheer, s.mood === 'win' ? 1 : s.mood === 'lose' ? -1 : 0, 4, dt);

      // Animation: the Axie sits still in the seat; a boost or a podium gets
      // its legs going, a hit plays the authored flinch once per impact.
      const excited = s.boosting || s.mood === 'win';
      character.setMoveSpeed(excited ? 3 : 0, 0.15);
      if (s.impact > 0.5 && a.lastImpact <= 0.5) character.playAnimation('Action.IdleGetHit');
      a.lastImpact = s.impact;
      const wantStun = s.mood === 'lose';
      if (wantStun && !a.stunned) { character.playAnimation('Stunned'); a.stunned = true; }
      if (!wantStun && a.stunned) { character.resumeLocomotion(); a.stunned = false; }
      character.update(Math.min(s.dt, 0.1));

      const idleBob = Math.sin(a.t * 2.1) * 0.01 * (1 - fast);
      const hop = a.cheer > 0 ? Math.abs(Math.sin(a.t * 6)) * 0.08 * a.cheer : 0;
      pose.position.set(
        seat.offset[0],
        seat.offset[1] - a.crouch * 0.12 + idleBob + hop,
        seat.offset[2],
      );
      pose.rotation.set(
        seat.pitch + a.crouch * 0.35 - (s.grounded ? 0 : 0.16) + a.cheer * -0.10 + a.flinch * 0.25,
        a.lean * 0.25,
        -a.lean * 0.45,
      );
      const squash = 1 - s.compression * 0.10;
      pose.scale.set(seat.scale * (2 - squash), seat.scale * squash, seat.scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      character.dispose();
    },
  };
}

/** An official starter Axie in the seat. Same pose language as the Mixer
 *  driver; the animation set is idle / run / gethit / jump from the files. */
export function starterDriver(inst: StarterInstance, def: AxieDefinition): DriverRig {
  const seat = def.starter!;
  const root = new THREE.Group();
  root.name = `StarterDriver:${def.id}`;
  const pose = new THREE.Group();
  pose.position.set(...seat.offset);
  pose.rotation.set(seat.pitch, 0, 0);
  pose.scale.setScalar(seat.scale);
  pose.add(inst.root);
  root.add(pose);

  const a = { lean: 0, crouch: 0, cheer: 0, flinch: 0, t: 0, lastImpact: 0, running: false, wasGrounded: true };
  let disposed = false;
  const fade = (to: 'idle' | 'run') => {
    const from = to === 'idle' ? inst.actions.run : inst.actions.idle;
    const target = inst.actions[to];
    target.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    from.fadeOut(0.18);
  };

  return {
    kind: 'starter',
    root,
    update(s) {
      if (disposed) return;
      const dt = Math.min(s.dt, 0.05);
      a.t += dt;
      const fast = clamp01(s.speed / Math.max(8, s.topSpeed));
      a.lean = damp(a.lean, (s.steer * 0.22 + (s.drifting ? s.driftDir * 0.34 : 0)) * (0.4 + 0.6 * fast), 9, dt);
      a.crouch = damp(a.crouch, fast * 0.10 + (s.boosting ? 0.07 : 0) + s.compression * 0.16, 11, dt);
      a.flinch = Math.max(damp(a.flinch, 0, 5, dt), s.impact);
      a.cheer = damp(a.cheer, s.mood === 'win' ? 1 : s.mood === 'lose' ? -1 : 0, 4, dt);

      const wantRun = s.boosting || s.mood === 'win';
      if (wantRun !== a.running) { a.running = wantRun; fade(wantRun ? 'run' : 'idle'); }
      if (s.impact > 0.5 && a.lastImpact <= 0.5) inst.actions.idlegethit.reset().setEffectiveWeight(1).play();
      a.lastImpact = s.impact;
      if (!s.grounded && a.wasGrounded && s.airTime < 0.1) inst.actions.jump.reset().setEffectiveWeight(1).play();
      a.wasGrounded = s.grounded;
      inst.mixer.update(Math.min(s.dt, 0.1));

      const idleBob = Math.sin(a.t * 2.1) * 0.01 * (1 - fast);
      const hop = a.cheer > 0 ? Math.abs(Math.sin(a.t * 6)) * 0.08 * a.cheer : 0;
      pose.position.set(seat.offset[0], seat.offset[1] - a.crouch * 0.12 + idleBob + hop, seat.offset[2]);
      pose.rotation.set(
        seat.pitch + a.crouch * 0.35 - (s.grounded ? 0 : 0.16) + a.cheer * -0.10 + a.flinch * 0.25,
        a.lean * 0.25,
        -a.lean * 0.45,
      );
      const squash = 1 - s.compression * 0.10;
      pose.scale.set(seat.scale * (2 - squash), seat.scale * squash, seat.scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      inst.mixer.stopAllAction();
    },
  };
}
