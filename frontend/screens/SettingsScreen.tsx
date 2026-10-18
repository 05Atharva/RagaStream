import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Toast from 'react-native-toast-message';
import SleepTimer, { useSleepTimerLabel } from '../components/SleepTimer';
import SpeedSheet, { SPEED_OPTIONS } from '../components/SpeedSheet';
import { supabase } from '../services/supabase';
import { queryClient } from '../services/queryClient';
import { useAuthStore } from '../store/authStore';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors } from '../constants/theme';

const APP_VERSION = '1.0.0';

function SettingsRow({
  icon,
  label,
  subtitle,
  onPress,
  danger = false,
  toggle,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  /** Renders a switch instead of a chevron. */
  toggle?: { value: boolean; onChange: (value: boolean) => void };
}) {
  return (
    <Pressable
      onPress={toggle ? () => toggle.onChange(!toggle.value) : onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={22}
          color={danger ? '#ffb4ab' : 'rgba(255,255,255,0.6)'}
          style={styles.rowIcon}
        />
      ) : null}
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ false: 'rgba(255,255,255,0.2)', true: Colors.primary }}
          thumbColor="#FFFFFF"
        />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isSpeedVisible, setIsSpeedVisible] = useState(false);
  const [isSleepVisible, setIsSleepVisible] = useState(false);
  const autoplay = useSettingsStore((s) => s.autoplay);
  const privateSession = useSettingsStore((s) => s.privateSession);
  const hiddenCount = useSettingsStore((s) => s.hiddenYoutubeIds.length);
  const recentSearchCount = useSettingsStore((s) => s.recentSearches.length);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const sleepLabel = useSleepTimerLabel();
  const speedOption = SPEED_OPTIONS.find((o) => o.rate === playbackRate);

  const handleClearCache = () => {
    Alert.alert('Clear cache?', 'Cached artwork and data will be removed. Your library is not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear cache',
        style: 'destructive',
        onPress: async () => {
          queryClient.clear();
          await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
          Toast.show({ type: 'success', text1: 'Cache cleared' });
        },
      },
    ]);
  };

  const handleClearHidden = () => {
    Alert.alert('Show hidden songs again?', `${hiddenCount} hidden songs can appear in radio and autoplay again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unhide all',
        onPress: () => {
          useSettingsStore.setState({ hiddenYoutubeIds: [] });
          Toast.show({ type: 'success', text1: 'Hidden songs cleared' });
        },
      },
    ]);
  };
  const session = useAuthStore((state) => state.session);
  const userEmail = session?.user?.email ?? 'Not signed in';
  const userName =
    (session?.user?.user_metadata?.name as string | undefined) ||
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    userEmail.split('@')[0];

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase?.auth.signOut();
          } catch {
            // session gone
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.9)" />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <View style={styles.profileSection}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{userName.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.profileName}>{userName}</Text>
          <Text style={styles.profileEmail}>{userEmail}</Text>
        </View>

        {/* Playback */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Playback</Text>
          <SettingsRow
            icon="infinite-outline"
            label="Autoplay"
            subtitle="Keep listening to similar music when your music ends"
            toggle={{ value: autoplay, onChange: (v) => useSettingsStore.getState().setAutoplay(v) }}
          />
          <SettingsRow
            icon="speedometer-outline"
            label="Playback speed"
            subtitle={speedOption ? `${speedOption.label} (${speedOption.hint})` : `${playbackRate}x`}
            onPress={() => setIsSpeedVisible(true)}
          />
          <SettingsRow
            icon="moon-outline"
            label="Sleep timer"
            subtitle={sleepLabel ? (sleepLabel === 'End of track' ? 'Stops at the end of this track' : `${sleepLabel} left`) : 'Off'}
            onPress={() => setIsSleepVisible(true)}
          />
        </View>

        {/* Privacy & recommendations */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Privacy & recommendations</Text>
          <SettingsRow
            icon="eye-off-outline"
            label="Private session"
            subtitle="Don't save what you play to history, stats or Recently played"
            toggle={{ value: privateSession, onChange: (v) => useSettingsStore.getState().setPrivateSession(v) }}
          />
          <SettingsRow
            icon="remove-circle-outline"
            label="Hidden songs"
            subtitle={hiddenCount ? `${hiddenCount} songs excluded from radio and autoplay` : 'None'}
            onPress={hiddenCount ? handleClearHidden : undefined}
          />
          <SettingsRow
            icon="stats-chart-outline"
            label="Your listening stats"
            onPress={() => navigation.navigate('Stats')}
          />
        </View>

        {/* Storage */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Storage</Text>
          <SettingsRow
            icon="time-outline"
            label="Clear recent searches"
            subtitle={recentSearchCount ? `${recentSearchCount} saved` : 'Nothing saved'}
            onPress={
              recentSearchCount
                ? () => {
                    useSettingsStore.getState().clearRecentSearches();
                    Toast.show({ type: 'success', text1: 'Recent searches cleared' });
                  }
                : undefined
            }
          />
          <SettingsRow icon="trash-bin-outline" label="Clear cache" onPress={handleClearCache} />
        </View>

        {/* App */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>App</Text>
          <SettingsRow
            icon="information-circle-outline"
            label="About"
            subtitle={`RagaStream v${APP_VERSION}`}
          />
        </View>

        {/* Legal — disclaimer copy preserved from existing file; final wording TBD */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>Legal</Text>
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Personal Use Disclaimer"
            subtitle="YouTube streaming via yt-dlp is for personal use only. Do not distribute publicly."
          />
        </View>

        {/* Sign Out */}
        <Pressable
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutPressed]}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>

        <Text style={styles.footer}>Made with ♪ for Indian music lovers</Text>
      </ScrollView>

      <SpeedSheet isVisible={isSpeedVisible} onClose={() => setIsSpeedVisible(false)} />
      <SleepTimer isVisible={isSleepVisible} onClose={() => setIsSleepVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    flex: 1,
  },

  // ── Header ──
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  headerBtn: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
  },

  // ── Profile ──
  content: {
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  profileSection: {
    alignItems: 'center',
    paddingBottom: 32,
    paddingTop: 8,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderColor: '#1e2020',
    borderRadius: 999,
    borderWidth: 2,
    height: 96,
    justifyContent: 'center',
    marginBottom: 16,
    width: 96,
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '700',
  },
  profileName: {
    color: '#e2e2e2',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  profileEmail: {
    color: 'rgba(204,195,216,0.75)',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },

  // ── Section cards ──
  sectionCard: {
    backgroundColor: '#1a1c1c',
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
  },
  sectionLabel: {
    color: 'rgba(210,187,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 12,
    textTransform: 'uppercase',
  },

  // ── Settings rows ──
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    paddingVertical: 4,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowIcon: {
    marginRight: 14,
    marginTop: 1,
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    color: '#e2e2e2',
    fontSize: 16,
    fontWeight: '600',
  },
  rowDanger: {
    color: '#ffb4ab',
  },
  rowSubtitle: {
    color: 'rgba(204,195,216,0.75)',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    marginTop: 4,
  },

  // ── Sign Out ──
  signOutBtn: {
    alignItems: 'center',
    borderColor: 'rgba(147,0,10,0.35)',
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 8,
    marginTop: 16,
    paddingVertical: 16,
  },
  signOutPressed: {
    opacity: 0.8,
  },
  signOutText: {
    color: '#ffb4ab',
    fontSize: 18,
    fontWeight: '600',
  },

  // ── Footer ──
  footer: {
    color: 'rgba(204,195,216,0.45)',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
});
