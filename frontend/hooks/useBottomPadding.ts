/**
 * useBottomPadding.ts
 *
 * Returns the correct bottom padding for scrollable screen content so it
 * never ends up hidden behind:
 *   1. The Android system navigation bar (via safe area insets)
 *   2. The absolutely-positioned tab bar
 *   3. The absolutely-positioned mini player (when a track is active)
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerStore } from '../store/playerStore';

export const TAB_BAR_HEIGHT = 60;
export const MINI_PLAYER_HEIGHT = 64; // must match MiniPlayer.tsx

export function useBottomPadding(): number {
  const insets = useSafeAreaInsets();
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  return (
    insets.bottom +
    TAB_BAR_HEIGHT +
    (hasTrack ? MINI_PLAYER_HEIGHT : 0)
  );
}
