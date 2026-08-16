import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { PlayerState } from './game-api.service';

const TICK_INTERVAL_MS = 2_500;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 10_000;

/**
 * Pushes live player state over a WebSocket instead of HTTP polling: connect,
 * subscribe once, then send a lightweight "tick" every 2.5s over the open
 * socket. The server pushes the result to every tab subscribed to the same
 * player, so multi-tab state converges instantly instead of within ~2.5s.
 *
 * Falls back to the caller's HTTP polling if the socket can't connect or
 * keeps dropping — some networks block WebSockets entirely.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private ws: WebSocket | null = null;
  private tickHandle?: ReturnType<typeof setInterval>;
  private reconnectHandle?: ReturnType<typeof setTimeout>;
  private reconnectAttempts = 0;
  private playerId = '';
  private manuallyClosed = false;
  private onState: ((state: PlayerState) => void) | null = null;
  private onFallbackNeeded: (() => void) | null = null;

  connect(playerId: string, onState: (state: PlayerState) => void, onFallbackNeeded: () => void): void {
    this.playerId = playerId;
    this.onState = onState;
    this.onFallbackNeeded = onFallbackNeeded;
    this.manuallyClosed = false;
    this.reconnectAttempts = 0;
    this.open();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    clearInterval(this.tickHandle);
    clearTimeout(this.reconnectHandle);
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(environment.webSocketUrl);
    } catch {
      this.onFallbackNeeded?.();
      return;
    }
    this.ws = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.send({ action: 'subscribe', playerId: this.playerId });
      clearInterval(this.tickHandle);
      this.tickHandle = setInterval(
        () => this.send({ action: 'tick', playerId: this.playerId }),
        TICK_INTERVAL_MS
      );
    });

    socket.addEventListener('message', (ev) => {
      try {
        this.onState?.(JSON.parse(ev.data));
      } catch {
        // ignore malformed frames
      }
    });

    socket.addEventListener('close', () => {
      clearInterval(this.tickHandle);
      if (this.manuallyClosed) return;
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // 'close' fires right after and drives reconnect/fallback — nothing to do here.
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.onFallbackNeeded?.();
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectHandle = setTimeout(() => this.open(), delay);
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
