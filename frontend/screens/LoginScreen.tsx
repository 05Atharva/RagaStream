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
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import Logo from '../components/Logo';
import AuthDivider from '../components/AuthDivider';
import GoogleButton from '../components/GoogleButton';

type LoginScreenProps = {
  onSwitchToSignup: () => void;
};

// ---------------------------------------------------------------------------
// Google Sign-In: try to load the native module — in Expo Go it won't exist.
// ---------------------------------------------------------------------------
let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null = null;
let statusCodes: typeof import('@react-native-google-signin/google-signin').statusCodes | null = null;

try {
  const gsi = require('@react-native-google-signin/google-signin');
  GoogleSignin = gsi.GoogleSignin;
  statusCodes = gsi.statusCodes;
} catch {
  // Native module unavailable (Expo Go) — Google sign-in button shows an Alert.
}

// ---------------------------------------------------------------------------
// Inline SVG icons for input fields (only used in this screen)
// ---------------------------------------------------------------------------
function MailIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M22 6l-10 7L2 6" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function LockIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 11V7a5 5 0 0110 0v4" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
        <Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />
    </Svg>
  );
}

export default function LoginScreen({ onSwitchToSignup }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);

  const redirectTo = useMemo(() => Linking.createURL('auth/callback'), []);

  const handleLogin = async () => {
    if (!supabase) {
      Alert.alert('Auth unavailable', 'Supabase environment variables are missing.');
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

  /**
   * Native Google Sign-In — stays entirely inside the app.
   *
   * Flow:
   *   1. GoogleSignin.signIn() shows the native Google account picker (in-app modal)
   *   2. We get an idToken from Google
   *   3. We exchange it with Supabase via signInWithIdToken()
   *
   * Requirements (one-time setup):
   *   - Create a Web Client ID in Google Cloud Console → APIs & Services → Credentials
   *   - Add that Web Client ID to Supabase Dashboard → Auth → Providers → Google
   *   - Set the same Web Client ID in GoogleSignin.configure({ webClientId: '...' })
   */
  const handleGoogleLogin = async () => {
    if (!GoogleSignin || !statusCodes) {
      Alert.alert(
        'Native build required',
        'Google Sign-In requires a native build (EAS). Run: npx expo run:android'
      );
      return;
    }

    if (!supabase) {
      Alert.alert('Auth unavailable', 'Supabase environment variables are missing.');
      return;
    }

    setIsLoading(true);

    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();

      // The idToken comes from Google's response
      const idToken = userInfo.data?.idToken;
      if (!idToken) {
        Alert.alert('Google sign in failed', 'No ID token received from Google.');
        setIsLoading(false);
        return;
      }

      // Exchange the Google ID token with Supabase for a session
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        Alert.alert('Google sign in failed', error.message);
      }
      // On success, the auth state listener in App.tsx will handle the session
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — do nothing
      } else if (code === statusCodes.IN_PROGRESS) {
        // Sign in already in progress
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services not available on this device.');
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        Alert.alert('Google sign in failed', message);
      }
    } finally {
      setIsLoading(false);
    }
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



  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoSection}>
            <View style={styles.logoCard}>
              <Logo size={56} />
            </View>
          </View>

          {/* Heading */}
          <View style={styles.headingSection}>
            <Text style={styles.heading}>Welcome back</Text>
            <Text style={styles.subheading}>Dive into the rhythm.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <GoogleButton
              label="Sign in with Google"
              onPress={handleGoogleLogin}
              disabled={isLoading}
            />

            <AuthDivider label="OR" />

            {/* Email field */}
            <View style={styles.inputRow}>
              <View style={styles.inputIcon}>
                <MailIcon />
              </View>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={[styles.input, styles.inputWithLeading]}
                value={email}
                onChangeText={setEmail}
              />
            </View>

            {/* Password field */}
            <View style={styles.inputRow}>
              <View style={styles.inputIcon}>
                <LockIcon />
              </View>
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.45)"
                secureTextEntry={!showPassword}
                style={[styles.input, styles.inputWithLeading, styles.inputWithTrailing]}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable style={styles.eyeToggle} onPress={() => setShowPassword(v => !v)}>
                <EyeIcon visible={showPassword} />
              </Pressable>
            </View>

            {/* Primary CTA */}
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            {/* Secondary actions — de-emphasised */}
            <View style={styles.secondaryLinks}>
              <Pressable onPress={handleForgotPassword} disabled={isLoading}>
                <Text style={styles.secondaryLink}>Forgot password?</Text>
              </Pressable>
            </View>
          </View>

          {/* Footer */}
          <Pressable onPress={onSwitchToSignup} disabled={isLoading} style={styles.footer}>
            <Text style={styles.footerText}>
              {"Don't have an account? "}
              <Text style={styles.footerLink}>Sign Up</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
    gap: 28,
  },
  logoSection: {
    alignItems: 'center',
  },
  logoCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: 96,
    height: 96,
  },
  headingSection: {
    gap: 8,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
  },
  subheading: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontWeight: '400',
  },
  form: {
    gap: 12,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    justifyContent: 'center',
    height: '100%',
  },
  input: {
    backgroundColor: '#121414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    color: '#FFFFFF',
    fontSize: 16,
    height: 56,
    paddingHorizontal: 16,
  },
  inputWithLeading: {
    paddingLeft: 48,
  },
  inputWithTrailing: {
    paddingRight: 48,
  },
  eyeToggle: {
    position: 'absolute',
    right: 16,
    height: '100%',
    justifyContent: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    height: 56,
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  secondaryLink: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
  },
  secondaryLinkSep: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 13,
  },
  footer: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 8,
  },
  footerText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
  },
  footerLink: {
    color: '#7C3AED',
    fontWeight: '600',
  },
});
