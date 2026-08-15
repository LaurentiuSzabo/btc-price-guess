import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

export type Direction = 'up' | 'down';

export interface Guess {
  guessId: string;
  direction: Direction;
  entryPrice: number;
  placedAt: number;
}

export interface Resolution {
  guessId: string;
  correct: boolean;
  delta: number;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  resolvedAt: number;
}

export interface PlayerState {
  playerId: string;
  score: number;
  guess: Guess | null;
  history: Resolution[];
  streak: number;
  wins: number;
  totalPlayed: number;
  price: number;
  resolution: Resolution | null;
}

export interface ResetState {
  playerId: string;
  score: number;
  guess: Guess | null;
  history: Resolution[];
  streak: number;
  wins: number;
  totalPlayed: number;
}

@Injectable({ providedIn: 'root' })
export class GameApiService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;

  getState(playerId: string): Promise<PlayerState> {
    return firstValueFrom(
      this.http.get<PlayerState>(`${this.base}/players/${playerId}`)
    );
  }

  placeGuess(playerId: string, direction: Direction): Promise<PlayerState> {
    return firstValueFrom(
      this.http.post<PlayerState>(`${this.base}/players/${playerId}/guess`, { direction })
    );
  }

  resetPlayer(playerId: string): Promise<ResetState> {
    return firstValueFrom(
      this.http.post<ResetState>(`${this.base}/players/${playerId}/reset`, {})
    );
  }
}
