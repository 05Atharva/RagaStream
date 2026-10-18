import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { successHaptic } from '../services/haptics';
import { Colors, TypeScale } from '../constants/theme';

const TIMER_OPTIONS: Array<{ label: string; value: number | 'endOfTrack' }> = [
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: 'End of track', value: 'endOfTrack' },
];

type SleepTimerProps = {
  isVisible: boolean;
  onClose: () => void;
};

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Live label for an active sleep timer ("12:34" or "End of track"), or null.
 * The timer itself lives in playbackController, so it survives this screen closing.
 */
export function useSleepTimerLabel(): string | null {
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sleepTimer.endsAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sleepTimer.endsAt]);

  if (sleepTimer.endOfTrack) return 'End of track';
  if (sleepTimer.endsAt) return formatRemaining(sleepTimer.endsAt - now);
  return null;
}

export default function SleepTimer({ isVisible, onClose }: SleepTimerProps) {
  const label = useSleepTimerLabel();

  const choose = (value: number | 'endOfTrack') => {
    successHaptic();
    playback.setSleepTimer(value);
    onClose();
  };

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>Sleep timer</Text>

        {label ? (
          <View style={styles.activeRow}>
            <Ionicons name="moon" size={18} color={Colors.primaryLight} />
            <Text style={styles.activeText}>
              {label === 'End of track' ? 'Stopping at the end of this track' : `${label} left`}
            </Text>
            <Pressable
              onPress={() => {
                playback.cancelSleepTimer();
                onClose();
              }}
              style={styles.turnOff}
              hitSlop={8}
            >
              <Text style={styles.turnOffText}>Turn off</Text>
            </Pressable>
          </View>
        ) : null}

        {TIMER_OPTIONS.map((option) => (
          <Pressable
            key={String(option.value)}
            onPress={() => choose(option.value)}
            style={({ pressed }) => [styles.optionRow, pressed && styles.optionRowPressed]}
          >
            <Text style={styles.optionLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </AnimatedBottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  title: {
    color: Colors.onBackground,
    fontSize: TypeScale.title,
    fontWeight: '700',
    marginBottom: 12,
  },
  activeRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  activeText: {
    color: Colors.onBackground,
    flex: 1,
    fontSize: TypeScale.small,
    fontWeight: '600',
  },
  turnOff: {
    paddingHorizontal: 4,
  },
  turnOffText: {
    color: Colors.primaryLight,
    fontSize: TypeScale.small,
    fontWeight: '700',
  },
  optionRow: {
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  optionRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionLabel: {
    color: Colors.onBackground,
    fontSize: TypeScale.body,
  },
});
