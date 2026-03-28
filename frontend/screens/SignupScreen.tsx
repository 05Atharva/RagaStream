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
import { BorderRadius, Colors, Spacing, Typography } from '../constants/theme';
import { supabase } from '../services/supabase';

type SignupScreenProps = {
  onSwitchToLogin: () => void;
};

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.brand}>RagaStream</Text>
            <Text style={styles.title}>Create your listening room</Text>
            <Text style={styles.subtitle}>
              Build a profile for playlists, uploads, and seamless archive discovery.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Signup</Text>

            <TextInput
              autoCapitalize="words"
              placeholder="Name"
              placeholderTextColor={Colors.muted}
              style={styles.input}
              value={name}
              onChangeText={setName}
            />

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

            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Confirm Password"
              placeholderTextColor={Colors.muted}
              secureTextEntry
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <Pressable style={styles.primaryButton} onPress={handleSignup} disabled={isLoading}>
              {isLoading ? (
                <ActivityIndicator color={Colors.onPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </Pressable>

            <Pressable onPress={onSwitchToLogin} disabled={isLoading}>
              <Text style={styles.footerText}>
                Already have an account? <Text style={styles.footerLink}>Sign in</Text>
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
