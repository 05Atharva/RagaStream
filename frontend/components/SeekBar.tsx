import { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Space } from '../constants/theme';
import { usePlayerStore } from '../store/playerStore';
import * as playback from '../services/playbackController';
import { gestureHaptic, tapHaptic } from '../services/haptics';
import Text from './ui/Text';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const s = Math.floor(value);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

type SeekBarProps = {
  /** Fill colour (Kesar by default; artwork accent on tinted screens). */
  fill: string;
  track: string;
  thumb: string;
  textColor: string;
  /** Text colour inside the time bubble (which is filled with `thumb`). */
  bubbleText: string;
};

const TRACK_H = 4;
const HIT_H = 36;

/**
 * Scrubber built on gestures rather than a native slider, so it can move the
 * way the brand moves: grab → thumb swells and a time bubble rises; release →
 * it settles back with the `out` curve. Tapping the track jumps there.
 */
export default function SeekBar({ fill, track, thumb, textColor, bubbleText }: SeekBarProps) {
  const position = usePlayerStore((s) => s.currentPosition);
  const duration = usePlayerStore((s) => s.duration);
  const [width, setWidth] = useState(0);
  const [scrubLabel, setScrubLabel] = useState<number | null>(null);

  const scrubbing = useSharedValue(0);
  const scrubX = useSharedValue(0);
  const widthSv = useSharedValue(0);
  const max = Math.max(duration, 1);
  const ratio = Math.min(position / max, 1);
  const ratioSv = useDerivedValue(() => ratio, [ratio]);

  const commit = (r: number) => {
    setScrubLabel(null);
    void playback.seek(r * max);
  };
  const updateLabel = (r: number) => setScrubLabel(r * max);

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      scrubX.value = Math.max(0, Math.min(e.x, widthSv.value));
      scrubbing.value = withTiming(1, { duration: Motion.duration.quick, easing: Motion.easing.out });
      runOnJS(tapHaptic)();
      runOnJS(updateLabel)(widthSv.value ? scrubX.value / widthSv.value : 0);
    })
    .onUpdate((e) => {
      scrubX.value = Math.max(0, Math.min(e.x, widthSv.value));
      runOnJS(updateLabel)(widthSv.value ? scrubX.value / widthSv.value : 0);
    })
    .onFinalize(() => {
      const r = widthSv.value ? scrubX.value / widthSv.value : 0;
      scrubbing.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out });
      runOnJS(gestureHaptic)();
      runOnJS(commit)(r);
    });

  const fillStyle = useAnimatedStyle(() => {
    const x = scrubbing.value > 0.01 ? scrubX.value : ratioSv.value * widthSv.value;
    return { width: x };
  });
  const thumbStyle = useAnimatedStyle(() => {
    const x = scrubbing.value > 0.01 ? scrubX.value : ratioSv.value * widthSv.value;
    const size = 12 + scrubbing.value * 8;
    return { width: size, height: size, borderRadius: size / 2, transform: [{ translateX: x - size / 2 }] };
  });
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: scrubbing.value,
    transform: [
      { translateX: Math.max(0, Math.min(scrubX.value - 26, widthSv.value - 52)) },
      { translateY: (1 - scrubbing.value) * 6 },
    ],
  }));

  return (
    <View style={{ gap: Space[1] }}>
      <GestureDetector gesture={pan}>
        <View
          style={{ height: HIT_H, justifyContent: 'center' }}
          onLayout={(e) => {
            setWidth(e.nativeEvent.layout.width);
            widthSv.value = e.nativeEvent.layout.width;
          }}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(position), text: formatTime(position) }}
        >
          <View style={{ height: TRACK_H, borderRadius: TRACK_H, backgroundColor: track, overflow: 'hidden' }}>
            <Animated.View style={[{ height: TRACK_H, backgroundColor: fill, borderRadius: TRACK_H }, fillStyle]} />
          </View>
          {width > 0 ? (
            <Animated.View style={[{ position: 'absolute', left: 0, backgroundColor: thumb }, thumbStyle]} />
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[
              { position: 'absolute', top: -26, left: 0, width: 52, alignItems: 'center', borderRadius: 8, paddingVertical: 3, backgroundColor: thumb },
              bubbleStyle,
            ]}
          >
            <Text variant="mono" color={bubbleText} tabular>
              {formatTime(scrubLabel ?? position)}
            </Text>
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="mono" color={textColor} tabular>{formatTime(scrubLabel ?? position)}</Text>
        <Text variant="mono" color={textColor} tabular>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}
