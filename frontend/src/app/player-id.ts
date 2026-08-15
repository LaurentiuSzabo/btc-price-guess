const STORAGE_KEY = 'btc-guess-player-id';

export function getPlayerId(): string {
  if (typeof localStorage === 'undefined') {
    return crypto.randomUUID();
  }
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
