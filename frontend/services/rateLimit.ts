import axios from 'axios';

/**
 * HTTP 429 from our backend means YouTube is rate-limiting the server. Retrying
 * straight away makes it worse, so callers wait for the Retry-After the server
 * sends instead of retrying or skipping ahead.
 */
export class RateLimitedError extends Error {
  constructor(public retryAfter: number) {
    super(`YouTube is limiting requests. Try again in ${waitPhrase(retryAfter)}.`);
  }
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof RateLimitedError || (axios.isAxiosError(error) && error.response?.status === 429);
}

/** Seconds to wait before asking again (the server's Retry-After, capped at an hour). */
export function retryAfterSeconds(error: unknown, fallback = 30): number {
  if (error instanceof RateLimitedError) return error.retryAfter;
  if (!axios.isAxiosError(error)) return fallback;
  const raw = Number(error.response?.headers?.['retry-after']);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 3600) : fallback;
}

/** "45 seconds" / "a minute" / "3 minutes". */
export function waitPhrase(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} seconds`;
  const minutes = Math.ceil(s / 60);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}
