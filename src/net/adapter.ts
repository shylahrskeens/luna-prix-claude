/** Network boundary.
 *
 *  Race code never talks to a socket. It talks to a NetworkAdapter, and there
 *  are two: one that runs the race locally against bots, and one that runs it
 *  against an authoritative server. Swapping them changes where race truth
 *  lives and nothing else — which is the point of having kept the simulation
 *  free of any renderer, DOM or transport dependency.
 */
import type { KartInput } from '../sim/kart';
import type { RaceResult } from '../sim/race';
import type { ValidatedLoadout } from '../sim/loadout';
import type { Mode } from '../data/rules';

export type ConnectionState = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface LobbyMember {
  id: string;
  name: string;
  ready: boolean;
  axieId: string;
  kartId: string;
  /** Round-trip time in ms, or null before the first measurement. */
  ping: number | null;
  isLocal: boolean;
  isBot: boolean;
}

export interface LobbyState {
  roomId: string;
  trackId: string;
  mode: Mode;
  laps: number;
  members: LobbyMember[];
  /** Seconds until the race starts, or null while still gathering players. */
  countdown: number | null;
  capacity: number;
  /** True once the race is running; a joiner after this spectates. */
  inProgress: boolean;
}

/** One racer's authoritative state, as the server sees it. */
export interface NetSnapshot {
  /** Server race clock this snapshot describes. */
  t: number;
  racers: {
    id: string;
    /** Packed kart state — see KartRuntime.snapshot(). */
    s: number[];
    /** Continuous lap progress. */
    p: number;
    pos: number;
  }[];
}

export interface NetworkAdapter {
  readonly kind: 'local' | 'ws';
  readonly state: ConnectionState;
  /** Human-readable status for the UI. Never a lie about where a race ran. */
  readonly statusText: string;

  connect(): Promise<void>;
  disconnect(): void;

  /** Join or create a room. */
  joinRoom(opts: {
    roomId?: string;
    trackId: string;
    mode: Mode;
    laps: number;
    name: string;
    loadout: ValidatedLoadout;
  }): Promise<LobbyState>;

  setReady(ready: boolean): void;
  leaveRoom(): void;

  /** Called every simulation step with the local player's input. */
  sendInput(tick: number, input: KartInput): void;

  /** Latest authoritative snapshot, or null when running locally. */
  latestSnapshot(): NetSnapshot | null;

  /** Submit a finished race for validation and ranking. */
  submitResult(result: RaceResult): Promise<{ accepted: boolean; reason?: string; rating?: number }>;

  /** Subscribe to lobby changes. Returns an unsubscribe function. */
  onLobby(fn: (s: LobbyState) => void): () => void;
  /** Fired when the server says the race starts, with the agreed seed. */
  onStart(fn: (info: { seed: number; startAt: number; members: LobbyMember[] }) => void): () => void;
  onError(fn: (message: string) => void): () => void;
}

/** Where the game looks for a server. Empty means offline-only, which is the
 *  default for a static build: the game must never sit waiting on a socket
 *  that was never configured. */
export function serverUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) return fromQuery;
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LUNA_SERVER;
  return fromEnv || null;
}
