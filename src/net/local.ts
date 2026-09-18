/** Offline adapter.
 *
 *  Runs the race on this machine against bots. It is labelled honestly
 *  everywhere it appears: results say "local", the lobby says "offline
 *  practice", and nothing it produces is presented as a network result.
 */
import type { RaceResult } from '../sim/race';
import type { ValidatedLoadout } from '../sim/loadout';
import { RIVALS } from '../sim/ai';
import type {
  ConnectionState, LobbyMember, LobbyState, NetSnapshot, NetworkAdapter,
} from './adapter';
import type { Mode } from '../data/rules';
import { AXIES } from '../data/axies';
import { KARTS } from '../data/karts';

export class LocalAdapter implements NetworkAdapter {
  readonly kind = 'local' as const;
  state: ConnectionState = 'offline';
  statusText = 'Offline — racing against bots on this device';
  private lobby: LobbyState | null = null;
  private lobbyFns: ((s: LobbyState) => void)[] = [];
  private startFns: ((i: { seed: number; startAt: number; members: LobbyMember[] }) => void)[] = [];
  private errorFns: ((m: string) => void)[] = [];

  async connect(): Promise<void> {
    this.state = 'offline';
  }
  disconnect(): void {}

  async joinRoom(opts: {
    roomId?: string; trackId: string; mode: Mode; laps: number;
    name: string; loadout: ValidatedLoadout;
  }): Promise<LobbyState> {
    const members: LobbyMember[] = [{
      id: opts.loadout.playerId, name: opts.name, ready: true,
      axieId: opts.loadout.axieId, kartId: opts.loadout.kartId,
      ping: null, isLocal: true, isBot: false,
    }];
    for (let i = 0; i < 7; i++) {
      members.push({
        id: `bot-${i + 1}`, name: RIVALS[i % RIVALS.length].name, ready: true,
        axieId: AXIES[i % AXIES.length].id, kartId: KARTS[i % KARTS.length].id,
        ping: null, isLocal: false, isBot: true,
      });
    }
    this.lobby = {
      roomId: 'local', trackId: opts.trackId, mode: opts.mode, laps: opts.laps,
      members, countdown: null, capacity: 8, inProgress: false,
    };
    this.emitLobby();
    return this.lobby;
  }

  setReady(): void {}
  leaveRoom(): void {
    this.lobby = null;
  }
  sendInput(): void {}
  latestSnapshot(): NetSnapshot | null {
    return null;
  }

  async submitResult(result: RaceResult): Promise<{ accepted: boolean; reason?: string }> {
    // A local race can still be self-validated: an integrity flag holds the
    // result back exactly as a server would, so the rule is visible offline.
    if (!result.publishable) {
      return { accepted: false, reason: 'Result carries an integrity flag and was not published.' };
    }
    return { accepted: true };
  }

  onLobby(fn: (s: LobbyState) => void): () => void {
    this.lobbyFns.push(fn);
    return () => { this.lobbyFns = this.lobbyFns.filter((f) => f !== fn); };
  }
  onStart(fn: (i: { seed: number; startAt: number; members: LobbyMember[] }) => void): () => void {
    this.startFns.push(fn);
    return () => { this.startFns = this.startFns.filter((f) => f !== fn); };
  }
  onError(fn: (m: string) => void): () => void {
    this.errorFns.push(fn);
    return () => { this.errorFns = this.errorFns.filter((f) => f !== fn); };
  }

  private emitLobby(): void {
    if (this.lobby) for (const f of this.lobbyFns) f(this.lobby);
  }

  /** Start immediately — there is nobody to wait for. */
  start(seed: number): void {
    if (!this.lobby) return;
    this.lobby.inProgress = true;
    for (const f of this.startFns) f({ seed, startAt: Date.now(), members: this.lobby.members });
  }
}
