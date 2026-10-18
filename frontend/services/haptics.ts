/**
 * haptics.ts — light tactile feedback for primary interactions.
 * expo-haptics works in Expo Go; failures (unsupported devices) are ignored.
 */
import * as Haptics from 'expo-haptics';

/** Taps on transport controls, chips, toggles. */
export function tapHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Committed gestures: swipe-to-skip, swipe-to-queue, drag drop. */
export function gestureHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Confirmations: liked, saved, timer set. */
export function successHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
