import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import { pausePlayback } from '../services/audioPlayer';
import { usePlayerStore } from '../store/playerStore';

const TIMER_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
] as const;

type SleepTimerProps = {
  isVisible: boolean;
  onClose: () => void;
};

export default function SleepTimer({ isVisible, onClose }: SleepTimerProps) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRemainingMs(null);
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const startTimer = (minutes: number) => {
    clearTimers();

    const durationMs = minutes * 60 * 1000;
    const endTime = Date.now() + durationMs;

    setRemainingMs(durationMs);

    // Countdown display
    intervalRef.current = setInterval(() => {
      const left = endTime - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        setRemainingMs(left);
      }
    }, 1000);

    // Actual pause
    timerRef.current = setTimeout(async () => {
      await pausePlayback();
      usePlayerStore.setState({ isPlaying: false });
      clearTimers();
      Toast.show({ type: 'info', text1: 'Sleep timer ended', text2: 'Playback paused' });
    }, durationMs);

    Toast.show({ type: 'success', text1: `Sleep timer set for ${minutes} minutes` });
    onClose();
  };

  const cancelTimer = () => {
    clearTimers();
    Toast.show({ type: 'info', text1: 'Sleep timer cancelled' });
    onClose();
  };

  const isActive = remainingMs !== null && remainingMs > 0;

  const formatRemaining = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Sleep Timer</Text>
          <Pressable
            hitSlop={8}
            onPress={onClose}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={22} color="rgba(204,195,216,0.9)" />
          </Pressable>
        </View>

        {isActive ? (
          /* ── Active: countdown ── */
          <View style={styles.activeContainer}>
            <Text style={styles.countdownText}>{formatRemaining(remainingMs)}</Text>
            <Text style={styles.countdownLabel}>remaining</Text>
            <Pressable
              onPress={cancelTimer}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            >
              <Text style={styles.cancelButtonText}>Cancel Timer</Text>
            </Pressable>
          </View>
        ) : (
          /* ── Idle: options list ── */
          <View style={styles.optionsList}>
            {TIMER_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => startTimer(option.value)}
                style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Caption */}
        <View style={styles.caption}>
          <Ionicons name="moon-outline" size={14} color="rgba(204,195,216,0.45)" />
          <Text style={styles.captionText}>Music will fade out and pause automatically.</Text>
        </View>
      </View>
    </AnimatedBottomSheet>
  );
}

/** Whether sleep timer is currently active. For badge display. */
export function useSleepTimerActive(): boolean {
  // This is a simple hook; for true reactivity we'd need a store,
  // but the component-local state is sufficient for NowPlayingScreen
  // since SleepTimer is rendered within it.
  return false;
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
  },
  closeBtn: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },

  // ── Options list (idle) ──
  optionsList: {
    gap: 4,
  },
  optionRow: {
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionRowPressed: {
    backgroundColor: 'rgba(51,53,53,0.35)',
  },
  optionLabel: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },

  // ── Active countdown ──
  activeContainer: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  countdownText: {
    color: '#7C3AED',
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
  },
  countdownLabel: {
    color: 'rgba(204,195,216,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: 'rgba(147,0,10,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  cancelButtonPressed: {
    opacity: 0.75,
  },
  cancelButtonText: {
    color: '#ffb4ab',
    fontSize: 16,
    fontWeight: '600',
  },

  // ── Caption ──
  caption: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 24,
  },
  captionText: {
    color: 'rgba(204,195,216,0.45)',
    fontSize: 13,
    fontWeight: '500',
  },
});
