/**
 * Meend motion primitives — hand-authored on Reanimated's low-level API.
 * No layout-animation presets: every curve, duration and sequence is ours.
 *
 * Principles applied (12 principles of animation):
 *   - Slow in / slow out: `glide` for movement, `out` for arrivals, `in` for exits.
 *   - Follow-through: presses release with a 2% overshoot before settling.
 *   - Staging: entrances stagger at 40ms, capped at 6 items, so the eye leads.
 *   - Timing: interactions ≤ 300ms; only milestones run longer.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Motion } from '../constants/theme';

const { duration, easing } = Motion;

/**
 * Press feedback: compress quickly, release with a small overshoot.
 * Returns handlers for any Pressable plus the animated style for its child.
 */
export function usePressMotion(scaleTo: number = Motion.pressScale) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const onPressIn = useCallback(() => {
    scale.value = withTiming(reduced ? 1 : scaleTo, { duration: duration.instant, easing: easing.out });
  }, [reduced, scale, scaleTo]);

  const onPressOut = useCallback(() => {
    scale.value = reduced
      ? withTiming(1, { duration: duration.instant })
      : withSequence(
          withTiming(1.02, { duration: 120, easing: easing.out }),
          withTiming(1, { duration: duration.quick, easing: easing.standard })
        );
  }, [reduced, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return { onPressIn, onPressOut, style };
}

/**
 * Rise: content arrives from 14pt below while fading in, on the `out` curve.
 * `index` staggers siblings. Plays once per mount; reduced motion fades only.
 */
export function useRise(index = 0, enabled = true) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(enabled ? 0 : 1);
  const played = useRef(!enabled);

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    const delay = Math.min(index, Motion.staggerMax) * Motion.stagger;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: reduced ? duration.quick : duration.glide, easing: easing.out })
    );
  }, [index, progress, reduced]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * Motion.rise }],
  }));
}

/**
 * True only for a screen's very first render, so tab revisits don't replay
 * entrances (repeated motion becomes noise).
 */
export function useFirstMount() {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return first.current;
}
