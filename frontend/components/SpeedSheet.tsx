import React from 'react';
import { View } from 'react-native';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import SheetRow, { SheetHeader } from './ui/SheetRow';
import Text from './ui/Text';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { tapHaptic } from '../services/haptics';
import { Space } from '../constants/theme';

// Pitch moves with speed on purpose: "slowed" and "sped up" edits are a style.
export const SPEED_OPTIONS = [
  { rate: 0.8, label: 'Slowed', hint: '0.8×' },
  { rate: 0.9, label: 'A little slower', hint: '0.9×' },
  { rate: 1, label: 'Normal', hint: '1×' },
  { rate: 1.1, label: 'A little faster', hint: '1.1×' },
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
      <View style={{ paddingBottom: Space[3], paddingHorizontal: Space[3] }}>
        <SheetHeader title="Playback speed" subtitle="Stays on for every song until you change it." />
        {SPEED_OPTIONS.map((option) => (
          <SheetRow
            key={option.rate}
            label={option.label}
            selected={option.rate === rate}
            onPress={() => {
              tapHaptic();
              void playback.setPlaybackRate(option.rate);
              onClose();
            }}
            leading={
              <View style={{ alignItems: 'center', width: 40 }}>
                <Text variant="mono" color={option.rate === rate ? 'accentInk' : 'textSecondary'} tabular>
                  {option.hint}
                </Text>
              </View>
            }
          />
        ))}
      </View>
    </AnimatedBottomSheet>
  );
}
