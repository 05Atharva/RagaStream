import { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Brand, Layout, Motion, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';
import Rise from '../motion/Rise';
import { navigate } from '../navigation/navigationRef';
import { firstNameFrom, shouldShowWelcome } from '../services/importLogic';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { MeendMark } from './Logo';
import Button from './ui/Button';
import Text from './ui/Text';

const POINTS: Array<{ icon: React.ComponentProps<typeof Ionicons>['name']; text: string }> = [
  { icon: 'download-outline', text: 'Import from Spotify, YouTube and more' },
  { icon: 'radio-outline', text: 'Radio that learns what you finish' },
  { icon: 'text-outline', text: 'Lyrics that follow along' },
];

/** The saved settings load a moment after launch; wait so a returning user never sees a flash of welcome. */
function useSettingsHydrated() {
  const [ready, setReady] = useState(() => useSettingsStore.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    const off = useSettingsStore.persist.onFinishHydration(() => setReady(true));
    setReady(useSettingsStore.persist.hasHydrated());
    return off;
  }, [ready]);
  return ready;
}

/**
 * The first minute (US-23). Once per account, the first time an approved user
 * reaches the app: the Meend stroke draws, then the greeting, three quiet
 * points and two buttons rise in. Dismissible with back; never touches playback.
 */
export default function WelcomeHost() {
  const user = useAuthStore((s) => s.session?.user);
  const welcomed = useSettingsStore((s) => s.welcomedUserIds);
  const markWelcomed = useSettingsStore((s) => s.markWelcomed);
  const hydrated = useSettingsHydrated();

  if (!hydrated || !user || !shouldShowWelcome(welcomed, user.id)) return null;
  return <Welcome name={firstNameFrom(user)} onDone={(thenImport) => {
    markWelcomed(user.id);
    if (thenImport) navigate('Import');
  }} />;
}

function Welcome({ name, onDone }: { name: string; onDone: (thenImport: boolean) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const fade = useSharedValue(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    fade.value = withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.standard });
  }, [fade]);

  const leave = useCallback(
    (thenImport: boolean) => {
      if (leaving) return;
      setLeaving(true);
      fade.value = withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.in }, (finished) => {
        if (finished) runOnJS(onDone)(thenImport);
      });
    },
    [fade, leaving, onDone]
  );

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  // Words wait for the stroke to finish drawing (about 1.1 s); reduce-motion just fades them in.
  const wait = reduced ? 0 : 1000;
  const greeting = name ? `Welcome to RagaStream, ${name}` : 'Welcome to RagaStream';

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => leave(false)}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.root, fadeStyle]} accessibilityViewIsModal>
        <View pointerEvents="none" style={styles.backdropMark}>
          <MeendMark size={460} animate delay={250} stroke={Brand.kesar} dot={Brand.neel} />
        </View>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6], paddingTop: insets.top + Space[10] }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <MeendMark size={72} animate />
          <View style={{ gap: Space[8] }}>
            <Rise delay={wait} index={0} style={{ gap: Space[3] }}>
              <Text variant="display" accessibilityRole="header">{greeting}</Text>
              <Text variant="body" color="textSecondary">
                Your music, ad-free. Bring your playlists with you, or start with a song.
              </Text>
            </Rise>
            <View style={{ gap: Space[4] }}>
              {POINTS.map((p, i) => (
                <Rise key={p.text} delay={wait} index={i + 1} style={styles.point}>
                  <View style={styles.pointIcon}>
                    <Ionicons name={p.icon} size={20} color={colors.signal} />
                  </View>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>{p.text}</Text>
                </Rise>
              ))}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: Space[6] }} />
          <Rise delay={wait} index={4} style={{ gap: Space[2] }}>
            <Button label="Import a playlist" icon="download-outline" size="lg" fullWidth onPress={() => leave(true)} />
            <Button label="Start listening" variant="ghost" size="lg" fullWidth onPress={() => leave(false)} />
          </Rise>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, overflow: 'hidden' },
  backdropMark: { opacity: t.isDark ? 0.07 : 0.09, position: 'absolute', right: -120, top: -40 },
  content: { flexGrow: 1, gap: Space[8], paddingHorizontal: Layout.gutter + 4 },
  point: { alignItems: 'center', flexDirection: 'row', gap: Space[4] },
  pointIcon: {
    alignItems: 'center',
    backgroundColor: t.colors.signalSoft,
    borderRadius: Radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
}));
