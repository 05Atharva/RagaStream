/**
 * historyService.ts
 *
 * Centralised helper to record play history.
 * Called from every playback entry point so we never miss a play.
 * Failures are swallowed — we never block playback for telemetry.
 */
import { apiClient } from './apiClient';

/**
 * Record a song play in the user's history.
 * Also increments the song's play_count on the backend.
 */
export async function recordPlayHistory(songId: string): Promise<void> {
  try {
    await apiClient.post('/history', { song_id: songId });
  } catch {
    // Silent — don't block playback for telemetry.
  }
}
