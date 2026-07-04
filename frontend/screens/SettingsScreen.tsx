import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';

const APP_VERSION = '1.0.0';

function SettingsRow({
  icon,
  label,
  subtitle,
  onPress,
  danger = false,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
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
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const navigation = useNavigation();
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
