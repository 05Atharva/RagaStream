/**
 * MeendSeek — curved progress line (docs/SIGNATURE_LAYOUTS.md §1.5).
 * One gentle S-curve (the "meend" glide) across the full width. Progress is
 * mapped by arc length, so the playhead always sits at the end of the fill.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Motion, Space } from '../../constants/theme';
import { usePlayerStore } from '../../store/playerStore';
import * as playback from '../../services/playbackController';
import { gestureHaptic, tapHaptic } from '../../services/haptics';
import Text from '../ui/Text';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type MeendSeekProps = {
  /** Elapsed colour (Kesar). */
  fill: string;
  /** Remaining-line colour. */
  track: string;
  /** Playhead dot + time bubble fill. */
  thumb: string;
  /** Time row text colour. */
  textColor: string;
  /** Text colour inside the time bubble. */
  bubbleText: string;
};

const HIT_H = 36;
const MID = HIT_H / 2;
const AMP = 7;
const STROKE = 4;
const DOT_R = 6;
const SWELL = 1.5;
const BUBBLE_W = 52;
const SAMPLES_PER_SEGMENT = 60;
const SKIP = 10;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const s = Math.floor(value);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

type Curve = { d: string; xs: number[]; ys: number[]; ls: number[]; total: number };

/** Two mirrored cubic Béziers = one smooth wave, tangent-continuous at the middle. */
function buildCurve(w: number): Curve {
  const a = w / 6;
  const c = AMP * (4 / 3); // a cubic with both inner controls at c peaks at 0.75c = AMP
  const h = w / 2;
  const segs = [
    [0, MID, a, MID - c, h - a, MID - c, h, MID],
    [h, MID, h + a, MID + c, w - a, MID + c, w, MID],
  ];
  const xs: number[] = [];
  const ys: number[] = [];
  const ls: number[] = [];
  let len = 0;
  segs.forEach((s, si) => {
    for (let i = si === 0 ? 0 : 1; i <= SAMPLES_PER_SEGMENT; i += 1) {
      const t = i / SAMPLES_PER_SEGMENT;
      const u = 1 - t;
      const x = u * u * u * s[0] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6];
      const y = u * u * u * s[1] + 3 * u * u * t * s[3] + 3 * u * t * t * s[5] + t * t * t * s[7];
      if (xs.length) len += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
      xs.push(x);
      ys.push(y);
      ls.push(len);
    }
  });
  const d =
    `M${segs[0][0]} ${segs[0][1]} ` +
    segs.map((s) => `C${s[2].toFixed(2)} ${s[3].toFixed(2)} ${s[4].toFixed(2)} ${s[5].toFixed(2)} ${s[6].toFixed(2)} ${s[7].toFixed(2)}`).join(' ');
  return { d, xs, ys, ls, total: len };
}

/** Arc length at horizontal position x (curve is monotonic in x). */
function lenAtX(xs: number[], ls: number[], x: number) {
  'worklet';
  const n = xs.length;
  if (x <= xs[0]) return ls[0];
  if (x >= xs[n - 1]) return ls[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  const f = (x - xs[lo]) / Math.max(xs[hi] - xs[lo], 1e-6);
  return ls[lo] + f * (ls[hi] - ls[lo]);
}

/** Point on the curve at arc length l. Returns [x, y]. */
function pointAtLen(xs: number[], ys: number[], ls: number[], l: number) {
  'worklet';
  const n = ls.length;
  if (l <= 0) return [xs[0], ys[0]];
  if (l >= ls[n - 1]) return [xs[n - 1], ys[n - 1]];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (ls[m] <= l) lo = m;
    else hi = m;
  }
  const f = (l - ls[lo]) / Math.max(ls[hi] - ls[lo], 1e-6);
  return [xs[lo] + f * (xs[hi] - xs[lo]), ys[lo] + f * (ys[hi] - ys[lo])];
}

export default function MeendSeek({ fill, track, thumb, textColor, bubbleText }: MeendSeekProps) {
  const position = usePlayerStore((s) => s.currentPosition);
  const duration = usePlayerStore((s) => s.duration);
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const max = Math.max(duration, 1);
  const ratio = Math.min(Math.max(position / max, 0), 1);
  const curve = useMemo(() => (width > 0 ? buildCurve(width) : null), [width]);

  const scrubbing = useSharedValue(0);
  const scrubX = useSharedValue(0);
  const widthSv = useSharedValue(0);
  const ratioSv = useDerivedValue(() => ratio, [ratio]);

  const xs = curve?.xs ?? [0, 1];
  const ys = curve?.ys ?? [MID, MID];
  const ls = curve?.ls ?? [0, 1];
  const total = curve?.total ?? 1;

  /** Current arc length: finger while scrubbing, playback otherwise. */
  const lenSv = useDerivedValue(() => {
    if (scrubbing.value > 0.01) return lenAtX(xs, ls, scrubX.value);
    return ratioSv.value * total;
  }, [xs, ls, total]);

  const commit = (x: number) => {
    setScrubTime(null);
    const r = curve ? lenAtX(curve.xs, curve.ls, x) / curve.total : 0;
    void playback.seek(r * max);
  };
  const updateLabel = (x: number) => {
    const r = curve ? lenAtX(curve.xs, curve.ls, x) / curve.total : 0;
    setScrubTime(r * max);
  };

  const clampX = (x: number) => {
    'worklet';
    return Math.max(0, Math.min(x, widthSv.value));
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      scrubX.value = clampX(e.x);
      scrubbing.value = withTiming(1, { duration: reduced ? 1 : Motion.duration.quick, easing: Motion.easing.out });
      runOnJS(tapHaptic)();
      runOnJS(updateLabel)(scrubX.value);
    })
    .onUpdate((e) => {
      scrubX.value = clampX(e.x);
      runOnJS(updateLabel)(scrubX.value);
    })
    .onFinalize(() => {
      scrubbing.value = withTiming(0, { duration: reduced ? 1 : Motion.duration.base, easing: Motion.easing.out });
      runOnJS(gestureHaptic)();
      runOnJS(commit)(scrubX.value);
    });

  const fillProps = useAnimatedProps(() => ({
    strokeDashoffset: total - Math.min(Math.max(lenSv.value, 0), total),
  }));
  const dotProps = useAnimatedProps(() => {
    const p = pointAtLen(xs, ys, ls, lenSv.value);
    return { cx: p[0], cy: p[1], r: DOT_R * (1 + (SWELL - 1) * scrubbing.value) };
  });
  const bubbleStyle = useAnimatedStyle(() => {
    const p = pointAtLen(xs, ys, ls, lenSv.value);
    return {
      opacity: scrubbing.value,
      transform: [
        { translateX: Math.max(0, Math.min(p[0] - BUBBLE_W / 2, widthSv.value - BUBBLE_W)) },
        { translateY: reduced ? 0 : (1 - scrubbing.value) * 6 + (p[1] - MID) },
      ],
    };
  }, [xs, ys, ls]);

  const shown = scrubTime ?? position;

  return (
    <View style={{ gap: Space[1] }}>
      <GestureDetector gesture={pan}>
        <View
          style={{ height: HIT_H }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            setWidth(w);
            widthSv.value = w;
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(position), text: `${formatTime(position)} of ${formatTime(duration)}` }}
          accessibilityActions={[
            { name: 'increment', label: 'Forward 10 seconds' },
            { name: 'decrement', label: 'Back 10 seconds' },
          ]}
          onAccessibilityAction={(e) => {
            const dir = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
            if (dir) void playback.seek(Math.max(0, Math.min(position + dir * SKIP, max)));
          }}
        >
          {curve ? (
            <Svg width={width} height={HIT_H} style={{ position: 'absolute', left: 0, top: 0 }}>
              <Path d={curve.d} stroke={track} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
              <AnimatedPath
                d={curve.d}
                stroke={fill}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={[curve.total, curve.total]}
                animatedProps={fillProps}
              />
              <AnimatedCircle fill={thumb} animatedProps={dotProps} />
            </Svg>
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: -26,
                left: 0,
                width: BUBBLE_W,
                alignItems: 'center',
                borderRadius: 8,
                paddingVertical: 3,
                backgroundColor: thumb,
              },
              bubbleStyle,
            ]}
          >
            <Text variant="mono" color={bubbleText} tabular>
              {formatTime(shown)}
            </Text>
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="mono" color={textColor} tabular>{formatTime(shown)}</Text>
        <Text variant="mono" color={textColor} tabular>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}
