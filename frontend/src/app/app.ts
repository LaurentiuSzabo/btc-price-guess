import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { GameApiService, PlayerState, Resolution } from './game-api.service';
import { getPlayerId } from './player-id';
import { Theme, applyTheme, getStoredTheme } from './theme';
import { RealtimeService } from './realtime.service';

const RESOLVE_DELAY_MS = 60_000;
const POLL_INTERVAL_MS = 2_500;
const TICK_INTERVAL_MS = 1_000;
const FLASH_DURATION_MS = 700;
const RESULT_TOAST_MS = 3_800;
const SPARKLINE_POINTS = 40;
const CHART_W = 620;
const CHART_H = 190;
const CHART_PAD = 14;
const CANDLE_COUNT = 28;

interface Candle {
  h: number;
  wick: number;
  top: number;
  body: number;
  color: string;
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private api = inject(GameApiService);
  private realtime = inject(RealtimeService);
  private playerId = getPlayerId();
  private pollHandle?: ReturnType<typeof setInterval>;
  private tickHandle?: ReturnType<typeof setInterval>;
  private flashTimeout?: ReturnType<typeof setTimeout>;
  private toastTimeout?: ReturnType<typeof setTimeout>;

  readonly ready = signal(false);
  readonly error = signal<string | null>(null);
  readonly placing = signal(false);
  readonly resetting = signal(false);
  readonly pendingDirection = signal<'up' | 'down' | null>(null);
  readonly theme = signal<Theme>(getStoredTheme());

  readonly score = signal(0);
  readonly streak = signal(0);
  readonly wins = signal(0);
  readonly totalPlayed = signal(0);
  readonly price = signal<number | null>(null);
  readonly priceHistory = signal<number[]>([]);
  readonly flash = signal<'up' | 'down' | null>(null);
  readonly guess = signal<{ direction: 'up' | 'down'; entryPrice: number; placedAt: number } | null>(
    null
  );
  readonly now = signal(Date.now());
  readonly lastResult = signal<Resolution | null>(null);
  readonly recentResults = signal<Resolution[]>([]);

  // Purely decorative candlestick silhouette behind the page — generated once,
  // carries no real data (no numbers are ever shown against it).
  readonly candles = signal<Candle[]>(this.generateCandles());

  readonly remainingMs = computed(() => {
    const g = this.guess();
    if (!g) return 0;
    return Math.max(0, RESOLVE_DELAY_MS - (this.now() - g.placedAt));
  });

  readonly guessPhase = computed<'idle' | 'counting' | 'waiting-for-move'>(() => {
    const g = this.guess();
    if (!g) return 'idle';
    return this.remainingMs() > 0 ? 'counting' : 'waiting-for-move';
  });

  readonly remainingLabel = computed(() => {
    const ms = this.remainingMs();
    const s = Math.ceil(ms / 1000);
    return `0:${s.toString().padStart(2, '0')}`;
  });

  readonly countdownProgress = computed(() => {
    if (!this.guess()) return 0;
    return 1 - this.remainingMs() / RESOLVE_DELAY_MS;
  });

  readonly accuracyLabel = computed(() => {
    const total = this.totalPlayed();
    return total > 0 ? `${Math.round((this.wins() / total) * 100)}%` : '—';
  });

  private readonly chartScale = computed(() => {
    const points = this.priceHistory();
    const min = points.length ? Math.min(...points) : 0;
    const max = points.length ? Math.max(...points) : 1;
    const span = max - min || 1;
    return { min, max, span };
  });

  readonly sparklinePath = computed(() => this.buildSparklinePath(this.priceHistory()));
  readonly sparklineAreaPath = computed(() => this.buildSparklineArea(this.priceHistory()));

  // Trend over the visible chart window — drives the sparkline/delta color.
  readonly trendUp = computed(() => {
    const points = this.priceHistory();
    if (points.length < 2) return true;
    return points[points.length - 1] >= points[0];
  });

  readonly sparkColor = computed(() => {
    const light = this.theme() === 'light';
    if (this.trendUp()) return light ? '#0ca30c' : '#34d399';
    return light ? '#d03b3b' : '#ef4444';
  });

  readonly sessionDeltaLabel = computed(() => {
    const points = this.priceHistory();
    if (points.length < 2) return '';
    const diff = points[points.length - 1] - points[0];
    const pct = (diff / points[0]) * 100;
    const arrow = diff >= 0 ? '▲ +' : '▼ ';
    return `${arrow}${Math.abs(diff).toFixed(2)}  (${diff >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(3)}%)`;
  });

  readonly sessionHighLabel = computed(() => {
    const points = this.priceHistory();
    return points.length ? `$${Math.max(...points).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  });

  readonly sessionLowLabel = computed(() => {
    const points = this.priceHistory();
    return points.length ? `$${Math.min(...points).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  });

  // Both parts are derived from one rounded string so they never disagree —
  // formatting integer/decimal separately (e.g. Math.trunc + toFixed) can
  // round each half differently for values like x.995 due to float precision.
  private readonly priceFormatted = computed(() => {
    const p = this.price();
    if (p === null) return '0.00';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(p);
  });

  readonly priceIntegerPart = computed(() => this.priceFormatted().split('.')[0]);
  readonly priceDecimalPart = computed(() => this.priceFormatted().split('.')[1]);

  // Y position (in chart coordinates) of the guess's entry price, for the dashed lock line.
  readonly lockY = computed(() => {
    const g = this.guess();
    if (!g) return 0;
    const { min, span } = this.chartScale();
    return (CHART_PAD + (1 - (g.entryPrice - min) / span) * (CHART_H - CHART_PAD * 2)).toFixed(1);
  });

  // Unrealized P&L while a guess is pending — null until we have both a guess and a price.
  readonly pendingDelta = computed<number | null>(() => {
    const g = this.guess();
    const p = this.price();
    if (!g || p === null) return null;
    return p - g.entryPrice;
  });

  // true = currently resolving in the player's favor, false = against, null = no movement yet.
  readonly pendingIsWinning = computed<boolean | null>(() => {
    const g = this.guess();
    const delta = this.pendingDelta();
    if (!g || delta === null || delta === 0) return null;
    const priceWentUp = delta > 0;
    return g.direction === 'up' ? priceWentUp : !priceWentUp;
  });

  readonly pendingDiffLabel = computed<string>(() => {
    const delta = this.pendingDelta();
    if (delta === null) return '';
    return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
  });

  constructor() {
    applyTheme(this.theme());
  }

  async ngOnInit(): Promise<void> {
    await this.poll(); // fast first paint, same as before
    this.ready.set(true);
    this.tickHandle = setInterval(() => this.now.set(Date.now()), TICK_INTERVAL_MS);

    // Live updates move to the WebSocket from here; HTTP polling only comes
    // back if the socket can't connect or keeps dropping.
    this.realtime.connect(
      this.playerId,
      (state) => this.applyState(state),
      () => this.startFallbackPolling()
    );
  }

  ngOnDestroy(): void {
    this.realtime.disconnect();
    clearInterval(this.pollHandle);
    clearInterval(this.tickHandle);
    clearTimeout(this.flashTimeout);
    clearTimeout(this.toastTimeout);
  }

  private startFallbackPolling(): void {
    if (this.pollHandle) return;
    this.pollHandle = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  toggleTheme(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    applyTheme(next);
  }

  async onGuess(direction: 'up' | 'down'): Promise<void> {
    if (this.guess() || this.placing()) return;
    this.placing.set(true);
    this.pendingDirection.set(direction);
    this.error.set(null);
    try {
      const state = await this.api.placeGuess(this.playerId, direction);
      this.applyState(state);
    } catch {
      this.error.set("Couldn't place that guess — try again.");
    } finally {
      this.placing.set(false);
      this.pendingDirection.set(null);
    }
  }

  async onClearHistory(): Promise<void> {
    if (this.resetting()) return;
    this.resetting.set(true);
    try {
      const state = await this.api.resetPlayer(this.playerId);
      this.score.set(state.score);
      this.streak.set(state.streak);
      this.wins.set(state.wins);
      this.totalPlayed.set(state.totalPlayed);
      this.recentResults.set(state.history);
    } catch {
      this.error.set("Couldn't clear history — try again.");
    } finally {
      this.resetting.set(false);
    }
  }

  private async poll(): Promise<void> {
    try {
      const state = await this.api.getState(this.playerId);
      this.applyState(state);
      this.error.set(null);
    } catch {
      this.error.set("Can't reach the server right now — retrying…");
    }
  }

  private applyState(state: PlayerState): void {
    const prevPrice = this.price();
    if (prevPrice !== null && state.price !== prevPrice) {
      this.flash.set(state.price > prevPrice ? 'up' : 'down');
      clearTimeout(this.flashTimeout);
      this.flashTimeout = setTimeout(() => this.flash.set(null), FLASH_DURATION_MS);
    }

    this.score.set(state.score);
    this.streak.set(state.streak);
    this.wins.set(state.wins);
    this.totalPlayed.set(state.totalPlayed);
    this.price.set(state.price);
    this.guess.set(state.guess);
    this.priceHistory.update((h) => [...h, state.price].slice(-SPARKLINE_POINTS));
    this.recentResults.set(state.history);

    if (state.resolution) {
      this.lastResult.set(state.resolution);
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => this.lastResult.set(null), RESULT_TOAST_MS);
    }
  }

  // Small, self-contained relative-time formatter — reactive via the `now` tick signal.
  timeAgo(resolvedAt: number): string {
    const diffSec = Math.max(0, Math.round((this.now() - resolvedAt) / 1000));
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    return `${diffHr}h ago`;
  }

  private buildSparklinePath(points: number[]): string {
    if (points.length < 2) return '';
    const toXY = this.pointToXY(points);
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toXY(i, p)}`).join(' ');
  }

  private buildSparklineArea(points: number[]): string {
    if (points.length < 2) return '';
    const toXY = this.pointToXY(points);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toXY(i, p)}`).join(' ');
    return `${line} L ${CHART_W},${CHART_H} L 0,${CHART_H} Z`;
  }

  private pointToXY(points: number[]) {
    const { min, span } = this.chartScale();
    return (i: number, v: number) => {
      const x = (i / (points.length - 1)) * CHART_W;
      const y = CHART_PAD + (1 - (v - min) / span) * (CHART_H - CHART_PAD * 2);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    };
  }

  private generateCandles(): Candle[] {
    let cv = 50;
    return Array.from({ length: CANDLE_COUNT }, () => {
      cv = Math.min(92, Math.max(22, cv + (Math.random() - 0.48) * 26));
      const body = 18 + Math.random() * 34;
      return {
        h: Number(cv.toFixed(1)),
        wick: 100,
        top: Number((10 + Math.random() * 30).toFixed(1)),
        body: Number(body.toFixed(1)),
        color: Math.random() > 0.42 ? '#34d399' : '#ef4444',
      };
    });
  }
}
