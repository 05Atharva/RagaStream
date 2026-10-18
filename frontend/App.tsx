import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { NativeModules, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { queryClient } from './services/queryClient';
import AppModal from './components/AppModal';
import AuthGate from './components/AuthGate';
import MilestoneHost from './components/MilestoneHost';
import SongActionsHost from './components/SongActionsHost';
import { ToastHost } from './components/ui/Toast';
import { FlightLayer } from './motion/flight';
import SplashScreen from './screens/SplashScreen';
import RootNavigator from './navigation/RootNavigator';
import { navigationRef } from './navigation/navigationRef';
import { supabase } from './services/supabase';
import { useAuthStore } from './store/authStore';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

// Configure Google Sign-In if native module is available
try {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    // ⚠️ IMPORTANT: Replace with your actual Web Client ID from Google Cloud Console.
    // This is the *Web* client (not Android client) that matches your Supabase Google provider config.
    webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
    offlineAccess: true,
  });
} catch {
  // Native module unavailable (Expo Go) — Google sign-in won't work.
}

// react-native-track-player is not available in Expo Go; import
// dynamically so the rest of the app still works without native builds.
type TrackPlayerModule = typeof import('react-native-track-player');
const loadTrackPlayer = (): TrackPlayerModule | null => {
  // NativeModules.TrackPlayer is null in Expo Go — never call require() then,
  // because RNTP's module eval reads native constants and crashes immediately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((NativeModules as any).TrackPlayer == null) return null;
  try {
    return require('react-native-track-player') as TrackPlayerModule;
  } catch {
    return null;
  }
};

function AppShell() {
  const theme = useTheme();
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_500Medium,
  });
  const fontsReady = fontsLoaded || Boolean(fontError);
  const ready = hasHydrated && fontsReady;

  const navTheme = useMemo(() => {
    const base = theme.isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: theme.colors.bg,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.accent,
      },
    };
  }, [theme]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      {ready ? (
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style={splashDone ? (theme.isDark ? 'light' : 'dark') : 'light'} />
          {session ? (
            <>
              <RootNavigator />
              <SongActionsHost />
              <MilestoneHost />
            </>
          ) : (
            <AuthGate />
          )}
        </NavigationContainer>
      ) : null}
      {ready ? (
        <>
          <FlightLayer />
          <ToastHost />
          <AppModal />
        </>
      ) : null}
      {!splashDone ? <SplashScreen ready={ready} fontsLoaded={fontsReady} onFinish={finishSplash} /> : null}
    </View>
  );
}

export default function App() {
  const setSession = useAuthStore((state) => state.setSession);

  // Set up TrackPlayer on launch so lock-screen controls and Bluetooth
  // hardware buttons are registered. Skipped gracefully in Expo Go.
  useEffect(() => {
    const setup = async () => {
      const TP = loadTrackPlayer();
      if (!TP) return;

      const { Capability, AppKilledPlaybackBehavior } = TP;
      const TrackPlayer = TP.default;

      try {
        await TrackPlayer.setupPlayer();

        await TrackPlayer.updateOptions({
          android: {
            appKilledPlaybackBehavior:
              AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
          },
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.Stop,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
          ],
          progressUpdateEventInterval: 1,
        });
      } catch {
        // setupPlayer throws if already initialised — safe to ignore.
      }
    };

    void setup();
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [setSession]);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
