import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AuthGate from './components/AuthGate';
import BottomTabNavigator from './navigation/BottomTabNavigator';
import { Colors } from './constants/theme';
import { supabase } from './services/supabase';
import { useAuthStore } from './store/authStore';

// react-native-track-player is not available in Expo Go; import
// dynamically so the rest of the app still works without native builds.
type TrackPlayerModule = typeof import('react-native-track-player');
const loadTrackPlayer = (): TrackPlayerModule | null => {
  try {
    return require('react-native-track-player') as TrackPlayerModule;
  } catch {
    return null;
  }
};

// Extend React Navigation's DarkTheme with our custom palette
const RagaStreamTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.primary,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.onBackground,
    border: Colors.border,
    notification: Colors.primary,
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
    },
  },
});

export default function App() {
  const session = useAuthStore((state) => state.session);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
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
      <SafeAreaProvider>
        <NavigationContainer theme={RagaStreamTheme}>
          <StatusBar style="light" backgroundColor={Colors.background} />
          {!hasHydrated ? (
            <View style={styles.loadingScreen}>
              <ActivityIndicator color={Colors.primary} size="large" />
            </View>
          ) : session ? (
            <BottomTabNavigator />
          ) : (
            <AuthGate />
          )}
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
