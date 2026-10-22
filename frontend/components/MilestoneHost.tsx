import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Brand, Motion, Radius, Space, alpha } from '../constants/theme';
import { useColors, useTheme } from '../theme/ThemeProvider';
import { useSettingsStore } from '../store/settingsStore';
import { usePlaylists } from '../hooks/usePlaylists';
import { useLikedSongs } from '../hooks/useLiked';
import { useOnRepeat } from '../hooks/useHistory';
import { reachedMilestones, type Milestone } from '../services/milestones';
import { successHaptic } from '../services/haptics';
import { MeendMark } from './Logo';
import Button from './ui/Button';
import Text from './ui/Text';

const STROKE_COUNT = 12;

/** One of the strokes that bursts from the mark: travels out on a bending path. */
function BurstStroke({ index, play, color }: { index: number; play: boolean; color: string }) {
  const t = useSharedValue(0);
  const angle = (360 / STROKE_COUNT) * index + (index % 2 ? 8 : -8);
  const distance = 92 + (index % 3) * 18;

  useEffect(() => {
    if (!play) return;
    t.value = withDelay(1000 + (index % 4) * 30, withTiming(1, { duration: 760, easing: Motion.easing.out }));
  }, [index, play, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const bend = ((angle + p * 30) * Math.PI) / 180;
    const r = 30 + p * distance;
    return {
      opacity: p === 0 ? 0 : p < 0.6 ? 1 : (1 - p) / 0.4,
      transform: [
        { translateX: Math.cos(bend) * r },
        { translateY: Math.sin(bend) * r },
        { rotate: `${angle + 90 + p * 30}deg` },
        { scaleY: 1.4 - p },
      ],
    };
  });

  return <Animated.View style={[styles.stroke, { backgroundColor: color }, style]} />;
}

/**
 * The one place RagaStream exaggerates (12 principles: exaggeration, used
 * sparingly). The mark draws itself, the dot lands, glide strokes burst
 * outward, then the words rise in. One per milestone, never blocking play.
 */
function Celebration({ milestone, onDone }: { milestone: Milestone; onDone: () => void }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const reduced = useReducedMotion();
  const scrim = useSharedValue(0);
  const words = useSharedValue(reduced ? 1 : 0);
  const [landed, setLanded] = useState(reduced);

  useEffect(() => {
    scrim.value = withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.standard });
    if (!reduced) {
      words.value = withDelay(1150, withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.out }));
    }
  }, [reduced, scrim, words]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const wordsStyle = useAnimatedStyle(() => ({
    opacity: words.value,
    transform: [{ translateY: (1 - words.value) * 18 }],
  }));

  const close = () => {
    scrim.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.in });
    setTimeout(onDone, Motion.duration.base);
  };

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(colors.bg, 0.94) }, scrimStyle]}>
        <Pressable style={styles.center} onPress={close} accessibilityLabel="Dismiss celebration">
          <View style={styles.markStage}>
            {Array.from({ length: STROKE_COUNT }).map((_, i) => (
              <BurstStroke
                key={i}
                index={i}
                play={!reduced}
                color={i % 2 ? (isDark ? Brand.neelLight : Brand.neelDeep) : Brand.kesar}
              />
            ))}
            <MeendMark
              size={128}
              animate
              delay={200}
              onDrawn={() => {
                if (!landed) {
                  setLanded(true);
                  successHaptic();
                }
              }}
            />
          </View>
          <Animated.View style={[styles.words, wordsStyle]}>
            <Text variant="label" color="accentInk" align="center">Riyaz milestone</Text>
            <Text variant="display" align="center">{milestone.title}</Text>
            <Text variant="body" color="textSecondary" align="center">{milestone.body}</Text>
            <Button label="Keep going" onPress={close} size="lg" style={{ marginTop: Space[4] }} />
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

/** Watches the library and celebrates newly reached milestones one at a time. */
export default function MilestoneHost() {
  const playlistsQuery = usePlaylists();
  const likedQuery = useLikedSongs();
  const onRepeatQuery = useOnRepeat();
  const achieved = useSettingsStore((s) => s.achievedMilestones);
  const seeded = useSettingsStore((s) => s.milestonesSeeded);
  const markMilestones = useSettingsStore((s) => s.markMilestones);
  const [current, setCurrent] = useState<Milestone | null>(null);

  const ready = playlistsQuery.isSuccess && likedQuery.isSuccess && !onRepeatQuery.isLoading;
  const reached = useMemo(
    () =>
      ready
        ? reachedMilestones({
            playlists: playlistsQuery.data ?? [],
            likedCount: likedQuery.data?.length ?? 0,
            onRepeat: onRepeatQuery.data ?? [],
          })
        : [],
    [ready, playlistsQuery.data, likedQuery.data, onRepeatQuery.data]
  );

  useEffect(() => {
    if (!ready) return;
    // First run after install/upgrade: record what's already done without celebrating it.
    if (!seeded) {
      markMilestones(reached.map((m) => m.id), true);
      return;
    }
    if (current) return;
    const fresh = reached.filter((m) => !achieved.includes(m.id));
    if (!fresh.length) return;
    // Tiers in one group (e.g. a playlist jumping from 0 to 50 songs) celebrate
    // only the highest new tier; the lower ones are recorded quietly.
    const group = (id: string) => id.replace(/-\d+$/, '');
    const firstGroup = group(fresh[0].id);
    const sameGroup = fresh.filter((m) => group(m.id) === firstGroup);
    const next = sameGroup[sameGroup.length - 1];
    markMilestones(sameGroup.map((m) => m.id));
    setCurrent(next);
  }, [achieved, current, markMilestones, ready, reached, seeded]);

  if (!current) return null;
  return <Celebration milestone={current} onDone={() => setCurrent(null)} />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: Space[8] },
  markStage: { alignItems: 'center', height: 240, justifyContent: 'center', width: 240 },
  stroke: { borderRadius: Radius.pill, height: 14, position: 'absolute', width: 4 },
  words: { alignItems: 'center', gap: Space[3], maxWidth: 360 },
});
