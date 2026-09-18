/** Authoritative-server adapter.
 *
 *  The client sends inputs and renders; the server owns the race. Because the
 *  simulation has no renderer, DOM or transport dependency, the server runs
 *  the SAME RaceCore, the same kart physics and the same hazards — there is no
 *  second implementation to drift out of sync with this one.
 *
 *  Movement is predicted locally and corrected toward the server's snapshots,
 *  bounded so a correction never teleports a kart across the road.
 */
import type { KartInput } from '../sim/kart';
import type { RaceResult } from '../sim/race';
import type { ValidatedLoadout } from '../sim/loadout';
import type {
  ConnectionState, LobbyMember, LobbyState, NetSnapshot, NetworkAdapter,
} from './adapter';
import type { Mode } from '../data/rules';

type Msg =
  | { t: 'hello'; id: string; serverTime: number }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'start'; seed: number; startAt: number; members: LobbyMember[] }
  | { t: 'snap'; snap: NetSnapshot }
  | { t: 'pong'; sent: number }
  | { t: 'result'; accepted: boolean; reason?: string; rating?: number }
  | { t: 'error'; message: string };

const INPUT_HZ = 30;

export class WsAdapter implements NetworkAdapter {
  readonly kind = 'ws' as const;
  state: ConnectionState = 'offline';
  statusText = 'Not connected';
  private ws: WebSocket | null = null;
  private url: string;
  private id = '';
  private snap: NetSnapshot | null = null;
  private lobbyFns: ((s: LobbyState) => void)[] = [];
  private startFns: ((i: { seed: number; startAt: number; members: LobbyMember[] }) => void)[] = [];
  private errorFns: ((m: string) => void)[] = [];
  private resultResolve: ((r: { accepted: boolean; reason?: string; rating?: number }) => void) | null = null;
  private lastInputSent = 0;
  private pingTimer: number | null = null;
  ping: number | null = null;
  /** Reconnect backoff, capped so a dead server does not spin forever. */
  private attempts = 0;
  private pending: { roomId?: string; trackId: string; mode: Mode; laps: number; name: string; loadout: ValidatedLoadout } | null = null;

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.state = this.attempts === 0 ? 'connecting' : 'reconnecting';
      this.statusText = this.attempts === 0 ? 'Connecting…' : `Reconnecting (attempt ${this.attempts + 1})`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        this.fail(`Could not open a connection: ${(err as Error).message}`);
        reject(err);
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (this.state !== 'connected') {
          ws.close();
          this.fail('The server did not answer in time.');
          reject(new Error('timeout'));
        }
      }, 6000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        this.state = 'connected';
        this.attempts = 0;
        this.statusText = 'Connected';
        this.startPing();
        if (this.pending) this.send({ t: 'join', ...this.pending });
        resolve();
      };
      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onerror = () => { /* onclose carries the outcome */ };
      ws.onclose = () => {
        window.clearTimeout(timeout);
        this.stopPing();
        if (this.state === 'connected') {
          // Lost mid-session: try to come back before giving up on the race.
          this.state = 'reconnecting';
          this.statusText = 'Connection lost — reconnecting';
          this.scheduleReconnect();
        }
      };
    });
  }

  private scheduleReconnect(): void {
    this.attempts++;
    if (this.attempts > 5) {
      this.fail('Lost contact with the server. Falling back to offline play.');
      return;
    }
    const delay = Math.min(8000, 400 * Math.pow(2, this.attempts));
    window.setTimeout(() => { void this.connect().catch(() => undefined); }, delay);
  }

  private fail(message: string): void {
    this.state = 'failed';
    this.statusText = message;
    for (const f of this.errorFns) f(message);
  }

  disconnect(): void {
    this.stopPing();
    this.state = 'offline';
    this.ws?.close();
    this.ws = null;
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', sent: Date.now() }), 2000);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onMessage(ev: MessageEvent): void {
    let msg: Msg;
    try {
      msg = JSON.parse(String(ev.data)) as Msg;
    } catch {
      return; // malformed frames are dropped, never thrown
    }
    switch (msg.t) {
      case 'hello': this.id = msg.id; break;
      case 'lobby': {
        // The server does not know which member is us; mark it here so the
        // lobby UI can highlight the right row and read our own ready state.
        const lobby = {
          ...msg.lobby,
          members: msg.lobby.members.map((m) => ({
            ...m, isLocal: m.id === this.id, ping: m.id === this.id ? this.ping : m.ping,
          })),
        };
        for (const f of this.lobbyFns) f(lobby);
        break;
      }
      case 'start': for (const f of this.startFns) f(msg); break;
      case 'snap': this.snap = msg.snap; break;
      case 'pong': this.ping = Date.now() - msg.sent; break;
      case 'result':
        this.resultResolve?.({ accepted: msg.accepted, reason: msg.reason, rating: msg.rating });
        this.resultResolve = null;
        break;
      case 'error': for (const f of this.errorFns) f(msg.message); break;
    }
  }

  async joinRoom(opts: {
    roomId?: string; trackId: string; mode: Mode; laps: number;
    name: string; loadout: ValidatedLoadout;
  }): Promise<LobbyState> {
    this.pending = opts;
    if (this.state !== 'connected') await this.connect();
    this.send({
      t: 'join',
      roomId: opts.roomId,
      trackId: opts.trackId,
      mode: opts.mode,
      laps: opts.laps,
      name: opts.name,
      // The server recomputes stats from the part ids; the client's numbers are
      // a claim, not an authority.
      loadout: {
        playerId: opts.loadout.playerId,
        axieId: opts.loadout.axieId,
        kartId: opts.loadout.kartId,
        parts: opts.loadout.parts,
        rulesVersion: opts.loadout.rulesVersion,
        validationToken: opts.loadout.validationToken,
      },
    });
    return new Promise((resolve) => {
      const off = this.onLobby((s) => { off(); resolve(s); });
    });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }
  leaveRoom(): void {
    this.send({ t: 'leave' });
  }

  sendInput(tick: number, input: KartInput): void {
    const now = performance.now();
    if (now - this.lastInputSent < 1000 / INPUT_HZ) return;
    this.lastInputSent = now;
    // Quantised: eight bits of steering is more than a human can express and
    // it keeps the packet small enough to send thirty times a second.
    this.send({
      t: 'in',
      k: tick,
      s: Math.round(input.steer * 127),
      a: Math.round(input.throttle * 15),
      b: Math.round(input.brake * 15),
      d: input.drift ? 1 : 0,
    });
  }

  latestSnapshot(): NetSnapshot | null {
    return this.snap;
  }

  submitResult(result: RaceResult): Promise<{ accepted: boolean; reason?: string; rating?: number }> {
    return new Promise((resolve) => {
      if (this.state !== 'connected') {
        resolve({ accepted: false, reason: 'Not connected; the result was kept locally.' });
        return;
      }
      this.resultResolve = resolve;
      this.send({ t: 'result', result });
      window.setTimeout(() => {
        if (this.resultResolve === resolve) {
          this.resultResolve = null;
          resolve({ accepted: false, reason: 'The server did not confirm the result.' });
        }
      }, 5000);
    });
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

  get localId(): string {
    return this.id;
  }
}

/** Blend a locally predicted kart toward the server's authoritative state.
 *
 *  A small error is corrected smoothly so the kart never visibly snaps; a
 *  large one is applied outright, because past a few metres the prediction is
 *  simply wrong and smoothing it just makes the kart wrong for longer.
 */
export function reconcile(
  local: number[], remote: number[], dt: number,
  opts = { softLimit: 2.5, hardLimit: 9, rate: 8 },
): number[] {
  const dx = remote[0] - local[0];
  const dy = remote[1] - local[1];
  const dz = remote[2] - local[2];
  const err = Math.hypot(dx, dy, dz);
  const out = local.slice();
  if (err > opts.hardLimit) return remote.slice();
  const k = err < 0.05 ? 0 : 1 - Math.exp(-opts.rate * dt) * (err > opts.softLimit ? 0.4 : 1);
  for (let i = 0; i < 3; i++) out[i] = local[i] + (remote[i] - local[i]) * k;
  for (let i = 3; i < 6; i++) out[i] = remote[i];
  // Angles are taken from the server outright: a blended heading looks worse
  // than a corrected one and the error is bounded by the input rate anyway.
  for (let i = 6; i < remote.length; i++) out[i] = remote[i];
  return out;
}
