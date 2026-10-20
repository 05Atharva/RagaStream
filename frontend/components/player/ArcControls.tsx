/**
 * ArcControls — transport on a shallow thumb arc (docs/SIGNATURE_LAYOUTS.md §1.6).
 * Play/pause, shuffle and repeat are handled inside via playbackController;
 * next/previous are delegated so the screen can run the deck flick animation.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Elevation } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import { usePlayerStore } from '../../store/playerStore';
import * as playback from '../../services/playbackController';
import { tapHaptic } from '../../services/haptics';
import { usePressMotion } from '../../motion/primitives';
import PlayPauseIcon from '../../motion/PlayPauseIcon';
import Text from '../ui/Text';

export type ArcControlsProps = {
  /** Icon colour for previous/next and inactive modes. */
  ink: string;
  /** Inactive shuffle/repeat colour. */
  dim: string;
  /** Active shuffle/repeat colour. */
  activeColor: string;
  onNext: () => void;
  onPrevious: () => void;
};

const BTN = 52;
const PLAY = 72;
const RAISE = [26, 10, 0, 10, 26];
const CENTER_Y = 26 + PLAY / 2; // play centre; outer buttons rise above it
const HEIGHT = CENTER_Y + PLAY / 2;
const PAD = BTN / 2;

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function arcPath(pts: { x: number; y: number }[]) {
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function Slot({ cx, slot, size, children }: { cx: number; slot: number; size: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: CENTER_Y - RAISE[slot] - size / 2,
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

function GlyphButton({
  icon,
  color,
  size,
  label,
  onPress,
  active,
  badge,
}: {
  icon: IconName;
  color: string;
  size: number;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: React.ReactNode;
}) {
  const press = usePressMotion();
  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      style={{ width: BTN, height: BTN, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center', width: BTN, height: BTN }, press.style]}>
        <Ionicons name={icon} size={size} color={color} />
        {badge}
        {active !== undefined ? (
          <View style={{ position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: 2, backgroundColor: active ? color : 'transparent' }} />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

export default function ArcControls({ ink, dim, activeColor, onNext, onPrevious }: ArcControlsProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const shuffleMode = usePlayerStore((s) => s.shuffleMode);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const playPress = usePressMotion();

  const shuffleOn = shuffleMode !== 'off';
  const repeatOn = repeatMode !== 'off';

  const span = Math.max(width - PAD * 2, 0);
  const xs = RAISE.map((_, i) => PAD + (span * i) / 4);
  const pts = xs.map((x, i) => ({ x, y: CENTER_Y - RAISE[i] }));

  return (
    <View style={{ height: HEIGHT }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <>
          <Svg width={width} height={HEIGHT} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
            <Path d={arcPath(pts)} stroke={colors.border} strokeWidth={1.5} strokeLinecap="round" fill="none" />
          </Svg>

          <Slot cx={xs[0]} slot={0} size={BTN}>
            <GlyphButton
              icon="shuffle"
              size={24}
              color={shuffleOn ? activeColor : dim}
              active={shuffleOn}
              label={shuffleMode === 'smart' ? 'Smart Shuffle on' : shuffleMode === 'off' ? 'Shuffle off' : 'Shuffle on'}
              onPress={() => void playback.cycleShuffle()}
              badge={
                shuffleMode === 'smart' ? (
                  <Ionicons name="sparkles" size={11} color={activeColor} style={{ position: 'absolute', right: 4, top: 6 }} />
                ) : null
              }
            />
          </Slot>
          <Slot cx={xs[1]} slot={1} size={BTN}>
            <GlyphButton icon="play-skip-back" size={30} color={ink} label="Previous" onPress={onPrevious} />
          </Slot>
          <Slot cx={xs[2]} slot={2} size={PLAY}>
            <Pressable
              onPress={() => {
                tapHaptic();
                void playback.togglePlay();
              }}
              onPressIn={playPress.onPressIn}
              onPressOut={playPress.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              style={{ width: PLAY, height: PLAY }}
            >
              <Animated.View
                style={[
                  {
                    width: PLAY,
                    height: PLAY,
                    borderRadius: PLAY / 2,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  Elevation.floating,
                  playPress.style,
                ]}
              >
                {isLoading && !isPlaying ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <PlayPauseIcon playing={isPlaying} size={32} color={colors.onAccent} />
                )}
              </Animated.View>
            </Pressable>
          </Slot>
          <Slot cx={xs[3]} slot={3} size={BTN}>
            <GlyphButton icon="play-skip-forward" size={30} color={ink} label="Next" onPress={onNext} />
          </Slot>
          <Slot cx={xs[4]} slot={4} size={BTN}>
            <GlyphButton
              icon="repeat"
              size={24}
              color={repeatOn ? activeColor : dim}
              active={repeatOn}
              label={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'off' ? 'Repeat off' : 'Repeat all'}
              onPress={() => playback.cycleRepeat()}
              badge={
                repeatMode === 'one' ? (
                  <Text variant="label" color={activeColor} style={{ position: 'absolute', top: 15, fontSize: 9 }}>
                    1
                  </Text>
                ) : null
              }
            />
          </Slot>
        </>
      ) : null}
    </View>
  );
}
