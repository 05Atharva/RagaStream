import { useCallback, useEffect, useMemo, useState } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clearQueryCache, persistOptions, queryClient } from './services/queryClient';
import AccessGate from './components/AccessGate';
import AppModal from './components/AppModal';
import AuthGate from './components/AuthGate';
import ImportWatcher from './components/import/ImportWatcher';
import MilestoneHost from './components/MilestoneHost';
import SongActionsHost from './components/SongActionsHost';
import WelcomeHost from './components/WelcomeHost';
import { ToastHost } from './components/ui/Toast';
import { FlightLayer } from './motion/flight';
import SplashScreen from './screens/SplashScreen';
import RootNavigator from './navigation/RootNavigator';
import { navigationRef } from './navigation/navigationRef';
import { resetPlayback } from './services/playbackController';
import { supabase } from './services/supabase';
import { useAuthStore } from './store/authStore';
import { useImportStore } from './store/importStore';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

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
            <AccessGate>
              <RootNavigator />
              <SongActionsHost />
              <MilestoneHost />
              <ImportWatcher />
              <WelcomeHost />
            </AccessGate>
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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // The library cache is saved on the phone: never let the next account see it.
      // Sign-out (Settings, expired session, or a 401) also stops the music.
      if (event === 'SIGNED_OUT') {
        void resetPlayback();
        void clearQueryCache();
        useImportStore.getState().reset();
      }
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [setSession]);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </PersistQueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
