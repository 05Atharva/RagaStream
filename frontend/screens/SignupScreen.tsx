import React, { useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../services/supabase';
import Logo from '../components/Logo';
import AuthDivider from '../components/AuthDivider';
import GoogleButton from '../components/GoogleButton';

type SignupScreenProps = {
  onSwitchToLogin: () => void;
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

// Arrow icon for the CTA button
function ArrowIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M5 12h14M12 5l7 7-7 7" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function SignupScreen({ onSwitchToLogin }: SignupScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async () => {
    if (!supabase) {
      Alert.alert('Auth unavailable', 'Supabase environment variables are missing.');
      return;
    }

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert('Missing fields', 'Fill in every field.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Password mismatch', 'Your password confirmation does not match.');
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          name: name.trim(),
        },
      },
    });

    setIsLoading(false);

    if (error) {
      Alert.alert('Sign up failed', error.message);
      return;
    }

    Alert.alert('Account created', 'Your account is ready. You can continue into the app.');
  };

  const handleGoogleSignup = async () => {
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

      const idToken = userInfo.data?.idToken;
      if (!idToken) {
        Alert.alert('Google sign up failed', 'No ID token received from Google.');
        setIsLoading(false);
        return;
      }

      // signInWithIdToken creates the account if it doesn't exist
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });

      if (error) {
        Alert.alert('Google sign up failed', error.message);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — do nothing
      } else if (code === statusCodes.IN_PROGRESS) {
        // Already in progress
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services not available on this device.');
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error';
        Alert.alert('Google sign up failed', message);
      }
    } finally {
      setIsLoading(false);
    }
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
          {/* Logo — circle container on signup */}
          <View style={styles.logoSection}>
            <View style={styles.logoCircle}>
              <Logo size={56} />
            </View>
            <Text style={styles.heading}>Create Account</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <GoogleButton
              label="Sign up with Google"
              onPress={handleGoogleSignup}
              disabled={isLoading}
            />

            <AuthDivider label="or" />

            <TextInput
              autoCapitalize="words"
              placeholder="Name"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              value={name}
              onChangeText={setName}
            />

            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />

            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Password"
              placeholderTextColor="rgba(255,255,255,0.45)"
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />

            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Confirm Password"
              placeholderTextColor="rgba(255,255,255,0.45)"
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            {/* Primary CTA */}
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={handleSignup}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.primaryButtonInner}>
                  <Text style={styles.primaryButtonText}>Create Account</Text>
                  <ArrowIcon />
                </View>
              )}
            </Pressable>
          </View>

          {/* Footer */}
          <Pressable onPress={onSwitchToLogin} disabled={isLoading} style={styles.footer}>
            <Text style={styles.footerText}>
              {'Already have an account? '}
              <Text style={styles.footerLink}>Log In</Text>
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
    paddingTop: 48,
    paddingBottom: 32,
    gap: 28,
  },
  logoSection: {
    alignItems: 'center',
    gap: 20,
  },
  logoCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#121414',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: 96,
    height: 96,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#FFFFFF',
    fontSize: 16,
    height: 56,
    paddingHorizontal: 16,
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
  primaryButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
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
