import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('starts with a score of 0 and no active guess', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.score()).toBe(0);
    expect(app.guess()).toBeNull();
  });

  describe('pendingIsWinning', () => {
    it('is null when there is no active guess', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.price.set(100);
      expect(app.pendingIsWinning()).toBeNull();
    });

    it('is null when the price has not moved from the entry price', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(100);
      expect(app.pendingIsWinning()).toBeNull();
    });

    it('is true for an "up" guess once the price has risen', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(105);
      expect(app.pendingIsWinning()).toBe(true);
    });

    it('is false for an "up" guess once the price has fallen', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(95);
      expect(app.pendingIsWinning()).toBe(false);
    });

    it('is true for a "down" guess once the price has fallen', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'down', entryPrice: 100, placedAt: 0 });
      app.price.set(90);
      expect(app.pendingIsWinning()).toBe(true);
    });

    it('is false for a "down" guess once the price has risen', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'down', entryPrice: 100, placedAt: 0 });
      app.price.set(110);
      expect(app.pendingIsWinning()).toBe(false);
    });
  });

  describe('pendingDiffLabel', () => {
    it('is empty when there is no price data yet', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      expect(app.pendingDiffLabel()).toBe('');
    });

    it('shows a signed positive delta when ahead', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(102.5);
      expect(app.pendingDiffLabel()).toBe('+2.50');
    });

    it('shows a signed negative delta when behind', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(97.5);
      expect(app.pendingDiffLabel()).toBe('−2.50');
    });

    it('shows +0.00 when the price has not moved', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.price.set(100);
      expect(app.pendingDiffLabel()).toBe('+0.00');
    });
  });

  describe('timeAgo', () => {
    it('reports "just now" for very recent timestamps', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.now.set(10_000);
      expect(app.timeAgo(9_000)).toBe('just now');
    });

    it('reports seconds for under a minute', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.now.set(30_000);
      expect(app.timeAgo(0)).toBe('30s ago');
    });

    it('reports minutes for under an hour', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.now.set(5 * 60_000);
      expect(app.timeAgo(0)).toBe('5m ago');
    });

    it('reports hours beyond that', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.now.set(3 * 60 * 60_000);
      expect(app.timeAgo(0)).toBe('3h ago');
    });
  });

  describe('guessPhase and countdownProgress', () => {
    it('is idle with no active guess', () => {
      const app = TestBed.createComponent(App).componentInstance;
      expect(app.guessPhase()).toBe('idle');
      expect(app.countdownProgress()).toBe(0);
    });

    it('is counting down before 60s have elapsed', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.now.set(30_000);
      expect(app.guessPhase()).toBe('counting');
      expect(app.remainingLabel()).toBe('0:30');
      expect(app.countdownProgress()).toBeCloseTo(0.5, 5);
    });

    it('switches to waiting-for-move once 60s have elapsed', () => {
      const app = TestBed.createComponent(App).componentInstance;
      app.guess.set({ direction: 'up', entryPrice: 100, placedAt: 0 });
      app.now.set(65_000);
      expect(app.guessPhase()).toBe('waiting-for-move');
    });
  });
});
