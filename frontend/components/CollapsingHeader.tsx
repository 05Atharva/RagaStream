import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Colors, Motion, TypeScale } from '../constants/theme';
import { tapHaptic } from '../services/haptics';

export const TOP_BAR_CONTENT_HEIGHT = 56;
const PLAY_BUTTON_SIZE = 56;

/** Scroll position as a shared value plus a handler for any list's onScroll. */
export function useCollapsingHeader() {
  const scrollY = useSharedValue(0);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.value = event.nativeEvent.contentOffset.y;
    },
    [scrollY]
  );
  const onScrollOffset = useCallback((offset: number) => {
    scrollY.value = offset;
  }, [scrollY]);
  return { scrollY, onScroll, onScrollOffset };
}

type TopBarProps = {
  scrollY: SharedValue<number>;
  title: string;
  /** Solid colour the bar fades to (usually the artwork's muted tint). */
  background: string;
  /** Scroll offset at which the title is fully visible (≈ hero title position). */
  threshold: number;
  onBack: () => void;
  right?: React.ReactNode;
};

/**
 * Transparent over the hero, then fades to a solid tinted bar with the page
 * title once the big hero title has scrolled away — Spotify's playlist header.
 */
export function CollapsingTopBar({ scrollY, title, background, threshold, onBack, right }: TopBarProps) {
  const insets = useSafeAreaInsets();

  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [threshold - 80, threshold - 20], [0, 1], Extrapolation.CLAMP),
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [threshold - 20, threshold + 10], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [threshold - 20, threshold + 10], [8, 0], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={[styles.topBar, { paddingTop: insets.top, height: insets.top + TOP_BAR_CONTENT_HEIGHT }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: background }, barStyle]} />
      <Pressable onPress={onBack} hitSlop={8} style={styles.iconButton} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
      </Pressable>
      <Animated.Text numberOfLines={1} style={[styles.title, titleStyle]}>
        {title}
      </Animated.Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

type PlayButtonProps = {
  scrollY: SharedValue<number>;
  /** Y of the play button's slot inside the scroll content (from onLayout). */
  anchorY: number;
  isPlaying: boolean;
  onPress: () => void;
  disabled?: boolean;
};

/** Big play button that scrolls with the hero, then pins under the top bar. */
export function StickyPlayButton({ scrollY, anchorY, isPlaying, onPress, disabled }: PlayButtonProps) {
  const insets = useSafeAreaInsets();
  const pinnedY = insets.top + TOP_BAR_CONTENT_HEIGHT - PLAY_BUTTON_SIZE / 2;

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(anchorY - scrollY.value, pinnedY) }],
    opacity: anchorY > 0 ? 1 : 0,
  }));

  return (
    <Animated.View style={[styles.playWrap, style]} pointerEvents="box-none">
      <Pressable
        disabled={disabled}
        onPress={() => {
          tapHaptic();
          onPress();
        }}
        style={({ pressed }) => [
          styles.playButton,
          disabled && styles.playButtonDisabled,
          pressed && { transform: [{ scale: Motion.pressScale }] },
        ]}
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={26}
          color="#FFFFFF"
          style={!isPlaying ? { marginLeft: 3 } : undefined}
        />
      </Pressable>
    </Animated.View>
  );
}

/**
 * Reserves the play button's space at the end of the hero's actions row. The
 * screen measures that row (a direct child of the hero, which sits at the top
 * of the scroll content) with onLayout and passes its y as `anchorY`.
 */
export function PlayButtonSlot() {
  return <View style={styles.slot} />;
}

export const HERO_ACTIONS_ROW_HEIGHT = PLAY_BUTTON_SIZE;

const styles = StyleSheet.create({
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    left: 0,
    paddingHorizontal: 8,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  iconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  title: {
    color: '#FFFFFF',
    flex: 1,
    fontSize: TypeScale.body,
    fontWeight: '700',
    marginHorizontal: 8,
    marginRight: PLAY_BUTTON_SIZE + 16,
  },
  right: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'absolute',
    right: 8,
    bottom: 8,
  },
  playWrap: {
    position: 'absolute',
    right: 16,
    top: 0,
    zIndex: 11,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    height: PLAY_BUTTON_SIZE,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
    width: PLAY_BUTTON_SIZE,
  },
  playButtonDisabled: {
    opacity: 0.5,
  },
  slot: {
    height: PLAY_BUTTON_SIZE,
    width: PLAY_BUTTON_SIZE,
  },
});
