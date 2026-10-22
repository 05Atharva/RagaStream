import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AnimatedBottomSheet from './AnimatedBottomSheet';
import Button from './ui/Button';
import SheetRow, { SheetHeader } from './ui/SheetRow';
import Text from './ui/Text';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { successHaptic } from '../services/haptics';
import { Radius, Space } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';

const TIMER_OPTIONS: Array<{ label: string; value: number | 'endOfTrack' }> = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: 'End of this song', value: 'endOfTrack' },
];

type SleepTimerProps = {
  isVisible: boolean;
  onClose: () => void;
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Live label for an active sleep timer ("12:34" or "End of song"), or null.
 * The timer lives in playbackController, so it survives leaving Now Playing.
 */
export function useSleepTimerLabel(): string | null {
  const sleepTimer = usePlayerStore((s) => s.sleepTimer);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sleepTimer.endsAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sleepTimer.endsAt]);

  if (sleepTimer.endOfTrack) return 'End of song';
  if (sleepTimer.endsAt) return formatRemaining(sleepTimer.endsAt - now);
  return null;
}

export default function SleepTimer({ isVisible, onClose }: SleepTimerProps) {
  const colors = useColors();
  const label = useSleepTimerLabel();

  const choose = (value: number | 'endOfTrack') => {
    successHaptic();
    playback.setSleepTimer(value);
    onClose();
  };

  return (
    <AnimatedBottomSheet isVisible={isVisible} onClose={onClose}>
      <View style={{ paddingBottom: Space[3], paddingHorizontal: Space[3] }}>
        <SheetHeader title="Sleep timer" subtitle="Music pauses gently when it runs out." />
        {label ? (
          <View
            style={{
              alignItems: 'center',
              backgroundColor: colors.accentSoft,
              borderRadius: Radius.md,
              flexDirection: 'row',
              gap: Space[3],
              marginBottom: Space[2],
              padding: Space[4],
            }}
          >
            <Ionicons name="moon" size={20} color={colors.accentInk} />
            <View style={{ flex: 1 }}>
              <Text variant="label" color="accentInk">Active</Text>
              <Text variant={label === 'End of song' ? 'subtitle' : 'headline'} tabular>
                {label === 'End of song' ? 'Stops after this song' : `${label} left`}
              </Text>
            </View>
            <Button
              label="Turn off"
              size="sm"
              variant="secondary"
              onPress={() => {
                playback.cancelSleepTimer();
                onClose();
              }}
            />
          </View>
        ) : null}
        {TIMER_OPTIONS.map((option) => (
          <SheetRow
            key={String(option.value)}
            label={option.label}
            icon={option.value === 'endOfTrack' ? 'musical-note-outline' : 'time-outline'}
            onPress={() => choose(option.value)}
          />
        ))}
      </View>
    </AnimatedBottomSheet>
  );
}
