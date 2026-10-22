import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from '../services/toast';
import { confirmModal } from '../components/AppModal';
import Logo from '../components/Logo';
import SleepTimer, { useSleepTimerLabel } from '../components/SleepTimer';
import SpeedSheet, { SPEED_OPTIONS } from '../components/SpeedSheet';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import Segmented from '../components/ui/Segmented';
import Text from '../components/ui/Text';
import Toggle from '../components/ui/Toggle';
import Rise from '../motion/Rise';
import { supabase } from '../services/supabase';
import { clearQueryCache } from '../services/queryClient';
import { clearAllFeedback } from '../services/libraryActions';
import { useAccessRequests } from '../hooks/useAccessRequests';
import { pendingCount } from '../services/accessRequests';
import { countFeedback, useFeedback } from '../hooks/useFeedback';
import { useAuthStore } from '../store/authStore';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore, type ThemePreference } from '../store/settingsStore';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Elevation, Layout, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

const APP_VERSION = '1.0.0';

type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  onPress?: () => void;
  right?: React.ReactNode;
};

function Row({ icon, label, detail, onPress, right }: RowProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress && !right}
      style={({ pressed }) => [styles.row, pressed && onPress ? { backgroundColor: colors.surfaceRaised } : null]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={19} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        {detail ? <Text variant="caption" color="textSecondary">{detail}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null)}
    </Pressable>
  );
}

function Group({ title, children, index }: { title: string; children: React.ReactNode; index: number }) {
  const styles = useStyles();
  return (
    <Rise index={index} style={{ gap: Space[2] }}>
      <Text variant="label" color="textSecondary" style={{ paddingHorizontal: Space[1] }}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </Rise>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const styles = useStyles();
  const colors = useColors();
  const [isSpeedVisible, setIsSpeedVisible] = useState(false);
  const [isSleepVisible, setIsSleepVisible] = useState(false);
  const themePreference = useSettingsStore((s) => s.themePreference);
  const autoplay = useSettingsStore((s) => s.autoplay);
  const privateSession = useSettingsStore((s) => s.privateSession);
  const mirrorSongs = useSettingsStore((s) => s.hiddenYoutubeIds.length);
  const mirrorChannels = useSettingsStore((s) => s.hiddenChannels.length);
  const requests = useAccessRequests();
  const waiting = requests.isOwner ? pendingCount(requests.data) : 0;
  const feedback = useFeedback();
  // The server list is the truth; until it loads, show what this phone remembers.
  const counts = feedback.data ? countFeedback(feedback.data) : { songs: mirrorSongs, channels: mirrorChannels };
  const hiddenCount = counts.songs + counts.channels;
  const hiddenDetail = [
    counts.songs ? `${counts.songs} ${counts.songs === 1 ? 'song' : 'songs'}` : '',
    counts.channels ? `${counts.channels} ${counts.channels === 1 ? 'channel' : 'channels'}` : '',
  ].filter(Boolean).join(' and ');
  const recentSearchCount = useSettingsStore((s) => s.recentSearches.length);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const sleepLabel = useSleepTimerLabel();
  const speedOption = SPEED_OPTIONS.find((o) => o.rate === playbackRate);
  const session = useAuthStore((s) => s.session);
  const email = session?.user?.email ?? '';
  const name =
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    email.split('@')[0] ||
    'Listener';

  const signOut = () =>
    confirmModal({
      title: 'Sign out of RagaStream?',
      message: 'Your library, playlists and likes are saved to your account.',
      confirmLabel: 'Sign out',
      icon: 'log-out-outline',
      onConfirm: async () => {
        try {
          await supabase?.auth.signOut();
        } catch {
          // session already gone
        }
      },
    });

  const clearCache = () =>
    confirmModal({
      title: 'Clear cached artwork and data?',
      message: 'This frees up space. Your library, playlists and settings stay as they are.',
      confirmLabel: 'Clear',
      icon: 'trash-bin-outline',
      onConfirm: async () => {
        await clearQueryCache();
        await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
        Toast.show({ type: 'success', text1: 'Cache cleared' });
      },
    });

  const unhideAll = () =>
    confirmModal({
      title: `Show ${hiddenDetail} again?`,
      message: 'They can appear in radio, Autoplay, Smart Shuffle and Home again.',
      confirmLabel: 'Show again',
      onConfirm: async () => {
        try {
          await clearAllFeedback();
          Toast.show({ type: 'success', text1: 'Hidden songs restored' });
        } catch {
          Toast.show({ type: 'error', text1: "Couldn't restore hidden songs", text2: 'Check your connection and try again.' });
        }
      },
    });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Back" iconSize={26} />
        <Text variant="title">Settings</Text>
        <View style={{ width: Layout.touchTarget }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Rise style={styles.profile}>
          <View style={styles.avatar}>
            <Text variant="headline" color="onAccent">{name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" numberOfLines={1}>{name}</Text>
            {email ? <Text variant="caption" color="textSecondary" numberOfLines={1}>{email}</Text> : null}
          </View>
          <Button label="Stats" icon="stats-chart" size="sm" variant="secondary" onPress={() => navigation.navigate('Stats')} />
        </Rise>

        {requests.isOwner ? (
          <Group title="Account" index={1}>
            <Row
              icon="person-add-outline"
              label="Requests"
              detail={waiting > 0 ? (waiting === 1 ? '1 person waiting' : `${waiting} people waiting`) : 'Approve or decline new accounts'}
              onPress={() => navigation.navigate('Requests')}
              right={
                <View style={styles.trailing}>
                  {waiting > 0 ? (
                    <View style={styles.badge} accessibilityLabel={`${waiting} waiting`}>
                      <Text variant="mono" color="accentInk">{String(waiting)}</Text>
                    </View>
                  ) : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </View>
              }
            />
          </Group>
        ) : null}

        <Group title="Appearance" index={1}>
          <View style={{ gap: Space[3], padding: Space[4] }}>
            <Segmented<ThemePreference>
              value={themePreference}
              onChange={(v) => useSettingsStore.getState().setThemePreference(v)}
              options={[
                { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
                { value: 'light', label: 'Light', icon: 'sunny-outline' },
                { value: 'dark', label: 'Dark', icon: 'moon-outline' },
              ]}
            />
            <Text variant="caption" color="textSecondary">System follows your phone: light by day, dark at night.</Text>
          </View>
        </Group>

        <Group title="Playback" index={2}>
          <Row icon="infinite-outline" label="Autoplay" detail="Keep similar music playing when your list ends"
            right={<Toggle value={autoplay} onChange={(v) => useSettingsStore.getState().setAutoplay(v)} accessibilityLabel="Autoplay" />} />
          <Row icon="speedometer-outline" label="Playback speed" detail={speedOption ? `${speedOption.label} · ${speedOption.hint}` : `${playbackRate}×`} onPress={() => setIsSpeedVisible(true)} />
          <Row icon="moon-outline" label="Sleep timer" detail={sleepLabel ? (sleepLabel === 'End of song' ? 'Stops after this song' : `${sleepLabel} left`) : 'Off'} onPress={() => setIsSleepVisible(true)} />
        </Group>

        <Group title="Privacy & recommendations" index={3}>
          <Row icon="eye-off-outline" label="Private session" detail="Plays aren't saved to history, stats or Recently played"
            right={<Toggle value={privateSession} onChange={(v) => useSettingsStore.getState().setPrivateSession(v)} accessibilityLabel="Private session" />} />
          <Row icon="remove-circle-outline" label="Hidden songs" detail={hiddenCount ? `${hiddenDetail} kept out of recommendations` : 'None hidden'} onPress={hiddenCount ? unhideAll : undefined} />
        </Group>

        <Group title="Storage" index={4}>
          <Row icon="time-outline" label="Clear recent searches" detail={recentSearchCount ? `${recentSearchCount} saved` : 'Nothing saved'}
            onPress={recentSearchCount ? () => { useSettingsStore.getState().clearRecentSearches(); Toast.show({ type: 'success', text1: 'Recent searches cleared' }); } : undefined} />
          <Row icon="trash-bin-outline" label="Clear cache" detail="Artwork and offline data" onPress={clearCache} />
        </Group>

        <Group title="About" index={5}>
          <Row icon="information-circle-outline" label={`RagaStream ${APP_VERSION}`} detail="Indian music, ad-free" />
          <Row icon="shield-checkmark-outline" label="Personal use only" detail="Audio streams from YouTube via yt-dlp. Please don't distribute this app." />
        </Group>

        <Button label="Sign out" variant="danger" size="lg" fullWidth onPress={signOut} style={{ marginTop: Space[2] }} />

        <View style={styles.footer}>
          <Logo size={28} />
          <Text variant="caption" color="textTertiary">Made with care for every raga</Text>
        </View>
      </ScrollView>

      <SpeedSheet isVisible={isSpeedVisible} onClose={() => setIsSpeedVisible(false)} />
      <SleepTimer isVisible={isSleepVisible} onClose={() => setIsSleepVisible(false)} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space[2], paddingVertical: Space[1] },
  content: { gap: Space[6], paddingBottom: Space[16], paddingHorizontal: Layout.gutter, paddingTop: Space[2] },
  profile: { alignItems: 'center', flexDirection: 'row', gap: Space[4] },
  avatar: { alignItems: 'center', backgroundColor: t.colors.accent, borderRadius: Radius.pill, height: 60, justifyContent: 'center', width: 60 },
  group: { backgroundColor: t.colors.surface, borderRadius: Radius.lg, overflow: 'hidden', ...(t.isDark ? {} : Elevation.card) },
  row: { alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 60, paddingHorizontal: Space[4], paddingVertical: Space[3] },
  rowIcon: { alignItems: 'center', backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.sm, height: 34, justifyContent: 'center', width: 34 },
  trailing: { alignItems: 'center', flexDirection: 'row', gap: Space[2] },
  badge: { alignItems: 'center', backgroundColor: t.colors.accentSoft, borderRadius: Radius.pill, justifyContent: 'center', minHeight: 24, minWidth: 24, paddingHorizontal: Space[2] },
  footer: { alignItems: 'center', gap: Space[2], paddingTop: Space[4] },
}));
