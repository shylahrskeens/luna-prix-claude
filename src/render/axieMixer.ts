/** Sky Mavis Mixer 3D — the real Axie bodies and parts.
 *
 *  One service per renderer. It builds the Mixer lazily on the first request,
 *  loads the asset manifest from AXIE_ASSET_BASE, and hands back a playable
 *  character for an AxieDefinition's descriptor. Any failure — pack not
 *  hosted, manifest rejected, a part missing under strict assembly — is
 *  reported once and the service switches itself off, so every caller falls
 *  back to the procedural driver instead of racing with an empty seat.
 *
 *  `?mixer=0` in the URL turns it off for a session, which is how the
 *  procedural path stays testable now that it is no longer the default look.
 */
import type * as THREE from 'three';
import {
  createAxieMixer3D,
  type ThreeAxieMixer3D,
  type AxiePlayableCharacter,
  type AxieQualityId,
} from '@jaatster/threejs-axie-mixer3d-public';
import type { AxieDefinition } from '../data/axies';

/** Where the Mixer content pack is served from, relative to the page so the
 *  Pages build under a sub-path finds it. In dev, vite.config.ts streams the
 *  whole pack from the installed toolkit; the build carries the measured
 *  subset that tools/axiepack.mjs copies into public/assets/axie/. */
export const AXIE_ASSET_BASE: string =
  (import.meta.env?.VITE_AXIE_ASSET_BASE as string | undefined) || 'assets/axie/';

export type MixerStatus = 'off' | 'idle' | 'loading' | 'ready' | 'failed';

export class AxieMixerService {
  private mixer: Promise<ThreeAxieMixer3D> | null = null;
  private state: MixerStatus;
  private live = 0;
  lastError: string | null = null;
  quality: AxieQualityId = 'balanced';

  constructor(private readonly renderer: THREE.WebGLRenderer, enabled = true) {
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mixer') : null;
    this.state = enabled && param !== '0' ? 'idle' : 'off';
  }

  get status(): MixerStatus { return this.state; }
  get enabled(): boolean { return this.state !== 'off' && this.state !== 'failed'; }
  /** Characters currently alive, for the debug state. */
  get liveCharacters(): number { return this.live; }

  private boot(): Promise<ThreeAxieMixer3D> {
    if (!this.mixer) {
      this.state = 'loading';
      this.mixer = createAxieMixer3D({
        renderer: this.renderer,
        assetBaseUrl: AXIE_ASSET_BASE,
        maxUnusedEntries: 64,
        onDiagnostic: (event) => {
          if (event.severity === 'error') console.error('[Axie Mixer]', event);
        },
      }).then((m) => { this.state = 'ready'; return m; });
    }
    return this.mixer;
  }

  /** Resolve to a character, or null when the Mixer is off or has failed.
   *  A null never throws; the caller keeps its procedural driver. */
  async create(def: AxieDefinition, signal?: AbortSignal): Promise<AxiePlayableCharacter | null> {
    if (!this.enabled) return null;
    try {
      const mixer = await this.boot();
      if (signal?.aborted) return null;
      const character = await mixer.create({
        descriptor: def.mixer,
        signal,
        extensions: { quality: this.quality, artMode: 'faithful', strict: true },
      });
      this.live++;
      const dispose = character.dispose.bind(character);
      character.dispose = () => { if (!character.disposed) this.live--; dispose(); };
      return character;
    } catch (err) {
      if (signal?.aborted) return null;
      this.state = 'failed';
      this.lastError = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(`[Axie Mixer] disabled for this session: ${this.lastError}`);
      return null;
    }
  }

  dispose(): void {
    void this.mixer?.then((m) => m.dispose());
    this.mixer = null;
    if (this.state !== 'off') this.state = 'idle';
  }
}
