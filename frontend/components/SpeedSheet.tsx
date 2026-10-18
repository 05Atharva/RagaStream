import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import { Colors, TypeScale } from '../constants/theme';

// Pitch shifts with speed on purpose: "slowed" and "sped up" edits are a style.
export const SPEED_OPTIONS = [
  { rate: 0.8, label: 'Slowed', hint: '0.8×' },
  { rate: 0.9, label: 'Slightly slowed', hint: '0.9×' },
  { rate: 1, label: 'Normal', hint: '1×' },
  { rate: 1.1, label: 'Slightly sped up', hint: '1.1×' },
  { rate: 1.25, label: 'Sped up', hint: '1.25×' },
] as const;

export function speedLabel(rate: number) {
  return SPEED_OPTIONS.find((o) => o.rate === rate)?.hint ?? `${rate}×`;
}

type SpeedSheetProps = {
  isVisible: boolean;
  onClose: () => void;
};

export default function SpeedSheet({ isVisible, onClose }: SpeedSheetProps) {
  const rate = usePlayerStore((s) => s.playbackRate);

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.title}>Playback speed</Text>
        <Text style={styles.subtitle}>Applies to every song until you change it back.</Text>
        {SPEED_OPTIONS.map((option) => {
          const selected = option.rate === rate;
          return (
            <Pressable
              key={option.rate}
              onPress={() => {
                tapHaptic();
                void playback.setPlaybackRate(option.rate);
                onClose();
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
              <Text style={[styles.hint, selected && styles.labelSelected]}>{option.hint}</Text>
              <View style={styles.check}>
                {selected ? <Ionicons name="checkmark" size={20} color={Colors.primaryLight} /> : null}
              </View>
            </Pressable>
          );
        })}
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
  },
  subtitle: {
    color: Colors.textSubdued,
    fontSize: TypeScale.small,
    marginBottom: 8,
    marginTop: 4,
  },
  row: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 14,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  label: {
    color: Colors.onBackground,
    flex: 1,
    fontSize: TypeScale.body,
  },
  labelSelected: {
    color: Colors.primaryLight,
    fontWeight: '600',
  },
  hint: {
    color: Colors.textMuted,
    fontSize: TypeScale.small,
  },
  check: {
    alignItems: 'center',
    width: 24,
  },
});
