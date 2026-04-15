import React, { useEffect } from 'react';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, NativeModules, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import AuthGate from './components/AuthGate';
import { Colors } from './constants/theme';
import RootNavigator from './navigation/RootNavigator';
import { supabase } from './services/supabase';
import { useAuthStore } from './store/authStore';

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
      <GestureHandlerRootView style={styles.root}>
        <BottomSheetModalProvider>
          <SafeAreaProvider>
            <NavigationContainer theme={RagaStreamTheme}>
              <StatusBar style="light" backgroundColor={Colors.background} />
              {!hasHydrated ? (
                <View style={styles.loadingScreen}>
                  <ActivityIndicator color={Colors.primary} size="large" />
                </View>
              ) : session ? (
                <RootNavigator />
              ) : (
                <AuthGate />
              )}
            </NavigationContainer>
            <Toast />
          </SafeAreaProvider>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
