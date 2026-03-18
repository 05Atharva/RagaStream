import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import { supabase } from '../services/supabase';
import { createDemoSession, DEMO_EMAIL, DEMO_PASSWORD, useAuthStore } from '../store/authStore';

type LoginScreenProps = {
  onSwitchToSignup: () => void;
};

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ onSwitchToSignup }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);

  const redirectTo = useMemo(() => Linking.createURL('auth/callback'), []);

  const handleLogin = async () => {
    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      setSession(createDemoSession());
      return;
    }

    if (!supabase) {
      Alert.alert('Auth unavailable', `Use demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
      return;
    }

    if (!email || !password) {
      Alert.alert('Missing fields', 'Enter your email and password.');
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setIsLoading(false);

    if (error) {
      Alert.alert('Sign in failed', error.message);
    }
  };

  const handleGoogleLogin = async () => {
    if (!supabase) {
      Alert.alert('Auth unavailable', 'Supabase environment variables are missing.');
      return;
    }

    setIsLoading(true);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      setIsLoading(false);
      Alert.alert('Google sign in failed', error?.message ?? 'No auth URL returned.');
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'success' && result.url) {
      const parsedResult = Linking.parse(result.url);
      const code =
        parsedResult.queryParams && typeof parsedResult.queryParams.code === 'string'
          ? parsedResult.queryParams.code
          : null;

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          Alert.alert('Google sign in failed', exchangeError.message);
        }
      }
    }

    setIsLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      Alert.alert('Auth unavailable', 'Supabase environment variables are missing.');
      return;
    }

    if (!email.trim()) {
      Alert.alert('Email required', 'Enter your email first.');
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setIsLoading(false);

    if (error) {
      Alert.alert('Reset failed', error.message);
      return;
    }

    Alert.alert('Check your inbox', 'Password reset instructions have been sent.');
  };

  const handleDemoLogin = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setSession(createDemoSession());
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.brand}>RagaStream</Text>
            <Text style={styles.title}>Step back into your sound</Text>
            <Text style={styles.subtitle}>Sign in to continue your ragas, archives, and playlists.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Login</Text>

            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={Colors.muted}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />

            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Password"
              placeholderTextColor={Colors.muted}
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />

            <Pressable style={styles.primaryButton} onPress={handleLogin} disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color={Colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={handleGoogleLogin} disabled={isLoading}>
              <Text style={styles.secondaryButtonText}>Continue with Google</Text>
            </Pressable>

            <Pressable style={styles.demoButton} onPress={handleDemoLogin} disabled={isLoading}>
              <Text style={styles.demoButtonText}>Continue with Demo Account</Text>
            </Pressable>

            <Text style={styles.demoHint}>Demo: demo@ragastream.com / password123</Text>

            <Pressable onPress={handleForgotPassword} disabled={isLoading}>
              <Text style={styles.linkText}>Forgot Password?</Text>
            </Pressable>

            <Pressable onPress={onSwitchToSignup} disabled={isLoading}>
              <Text style={styles.footerText}>
                No account yet? <Text style={styles.footerLink}>Create one</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.xl,
  },
  hero: {
    gap: Spacing.sm,
  },
  brand: {
    color: Colors.primaryLight,
    fontSize: Typography.fontSizeSm,
    fontWeight: Typography.fontWeightSemiBold,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXxl,
    fontWeight: Typography.fontWeightBold,
  },
  subtitle: {
    color: Colors.muted,
    fontSize: Typography.fontSizeMd,
    lineHeight: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  sectionTitle: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeXl,
    fontWeight: Typography.fontWeightBold,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    minHeight: 52,
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  primaryButtonText: {
    color: Colors.onPrimary,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightBold,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  demoButton: {
    alignItems: 'center',
    backgroundColor: '#25324A',
    borderRadius: BorderRadius.lg,
    justifyContent: 'center',
    minHeight: 52,
  },
  demoButtonText: {
    color: Colors.onBackground,
    fontSize: Typography.fontSizeMd,
    fontWeight: Typography.fontWeightSemiBold,
  },
  demoHint: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    textAlign: 'center',
  },
  linkText: {
    color: Colors.primaryLight,
    fontSize: Typography.fontSizeSm,
    textAlign: 'center',
  },
  footerText: {
    color: Colors.muted,
    fontSize: Typography.fontSizeSm,
    textAlign: 'center',
  },
  footerLink: {
    color: Colors.onBackground,
    fontWeight: Typography.fontWeightSemiBold,
  },
});
