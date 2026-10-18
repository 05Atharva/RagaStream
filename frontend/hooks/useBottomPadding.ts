/**
 * useBottomPadding.ts
 *
 * Bottom padding for scrollable tab content so nothing hides behind the
 * system navigation bar, the tab bar, or the mini player (when a track is
 * loaded). Adds one gutter of breathing room.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Layout, Space } from '../constants/theme';
import { usePlayerStore } from '../store/playerStore';

export const TAB_BAR_HEIGHT = Layout.tabBarHeight;
export const MINI_PLAYER_HEIGHT = Layout.miniPlayerHeight;

export function useBottomPadding(): number {
  const insets = useSafeAreaInsets();
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  return insets.bottom + TAB_BAR_HEIGHT + (hasTrack ? MINI_PLAYER_HEIGHT : 0) + Space[6];
}
