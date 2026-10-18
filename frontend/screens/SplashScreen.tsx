import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Brand, Fonts, Motion } from '../constants/theme';
import { MeendMark } from '../components/Logo';

type SplashProps = {
  /** App is hydrated and fonts are loaded. */
  ready: boolean;
  fontsLoaded: boolean;
  /** Called after the exit animation; unmount the splash then. */
  onFinish: () => void;
};

/**
 * Brand intro, continuous with the native splash (same Ink background, same
 * mark position). The stroke draws itself, the wordmark rises out of a mask,
 * then — once the app is ready — the whole thing lifts away to reveal Home.
 */
export default function SplashScreen({ ready, fontsLoaded, onFinish }: SplashProps) {
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(reduced);
  const word = useSharedValue(reduced ? 1 : 0);
  const exit = useSharedValue(0);

  useEffect(() => {
    if (drawn && fontsLoaded && !reduced) {
      word.value = withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.out });
    }
  }, [drawn, fontsLoaded, reduced, word]);

  useEffect(() => {
    if (!ready || !drawn) return;
    // Let the wordmark land before lifting away.
    exit.value = withDelay(
      reduced ? 0 : 380,
      withTiming(1, { duration: Motion.duration.glide, easing: Motion.easing.in }, (done) => {
        if (done) runOnJS(onFinish)();
      })
    );
  }, [drawn, exit, onFinish, ready, reduced]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const lockupStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -exit.value * 24 }, { scale: 1 - exit.value * 0.04 }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: (1 - word.value) * 22 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]} pointerEvents="none">
      <Animated.View style={[styles.lockup, lockupStyle]}>
        <MeendMark size={112} animate={!reduced} delay={120} onDrawn={() => setDrawn(true)} stroke={Brand.kesar} dot={Brand.neelLight} />
        <View style={styles.mask}>
          {fontsLoaded ? (
            <Animated.Text style={[styles.wordmark, wordStyle]} allowFontScaling={false}>
              RagaStream
            </Animated.Text>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', backgroundColor: Brand.ink, justifyContent: 'center', zIndex: 100 },
  lockup: { alignItems: 'center', gap: 18 },
  mask: { height: 44, overflow: 'hidden' },
  wordmark: { color: '#EEF1F8', fontFamily: Fonts.display, fontSize: 34, letterSpacing: -1, lineHeight: 42 },
});
