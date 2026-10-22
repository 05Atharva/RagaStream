import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { interpolate, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Motion } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';

const HEIGHT = 44;
const MID = HEIGHT / 2;
const AMP = 16;
const SAMPLES = 48;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Pt = { x: number; y: number };
const cubic = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};

/** The glide: one curve that rises and falls across the width, like a meend between two notes. */
function buildLine(w: number) {
  const p0 = { x: 0, y: MID };
  const p1 = { x: w * 0.5, y: MID };
  const p2 = { x: w, y: MID };
  const segs: Array<[Pt, Pt, Pt, Pt]> = [
    [p0, { x: w * 0.18, y: MID - AMP }, { x: w * 0.32, y: MID - AMP }, p1],
    [p1, { x: w * 0.68, y: MID + AMP }, { x: w * 0.82, y: MID + AMP }, p2],
  ];
  const d = `M0 ${MID} C${w * 0.18} ${MID - AMP} ${w * 0.32} ${MID - AMP} ${w * 0.5} ${MID} C${w * 0.68} ${MID + AMP} ${w * 0.82} ${MID + AMP} ${w} ${MID}`;
  const pts: Pt[] = [];
  segs.forEach((s, i) => {
    for (let k = i === 0 ? 0 : 1; k <= SAMPLES; k++) pts.push(cubic(s[0], s[1], s[2], s[3], k / SAMPLES));
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = cum[cum.length - 1];
  return { d, length, fracs: cum.map((c) => c / length), xs: pts.map((p) => p.x), ys: pts.map((p) => p.y) };
}

/**
 * Matching progress in the brand vocabulary: a Meend curve fills from left to
 * right and a Neel dot rides its head (the note it is gliding to). `fraction`
 * is 0..1; changes glide, so the line never jumps when a poll lands.
 */
export default function MeendProgress({ fraction }: { fraction: number }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.min(1, Math.max(0, fraction)), {
      duration: reduced ? Motion.duration.quick : 1100,
      easing: Motion.easing.glide,
    });
  }, [fraction, progress, reduced]);

  const line = useMemo(() => (width > 0 ? buildLine(width) : null), [width]);

  const fillProps = useAnimatedProps(() => ({ strokeDashoffset: (line?.length ?? 0) * (1 - progress.value) }));
  const dotProps = useAnimatedProps(() => {
    if (!line) return { cx: 0, cy: MID, r: 0 };
    return {
      cx: interpolate(progress.value, line.fracs, line.xs),
      cy: interpolate(progress.value, line.fracs, line.ys),
      r: progress.value > 0.002 ? 5 : 0,
    };
  });

  return (
    <View
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height: HEIGHT }}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      {line ? (
        <Svg width={width} height={HEIGHT}>
          <Path d={line.d} fill="none" stroke={colors.surfaceRaised} strokeWidth={6} strokeLinecap="round" />
          <AnimatedPath
            d={line.d}
            fill="none"
            stroke={colors.accent}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${line.length} ${line.length}`}
            animatedProps={fillProps}
          />
          <AnimatedCircle fill={colors.signal} animatedProps={dotProps} />
        </Svg>
      ) : null}
    </View>
  );
}
