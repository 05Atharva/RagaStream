import { useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from '../services/supabase';
import { signInWithGoogle } from '../services/googleAuth';
import { showModal } from '../components/AppModal';
import AuthDivider from '../components/AuthDivider';
import AuthLayout from '../components/AuthLayout';
import GoogleButton from '../components/GoogleButton';
import Button from '../components/ui/Button';
import Text from '../components/ui/Text';
import TextField from '../components/ui/TextField';
import { Space } from '../constants/theme';

type LoginScreenProps = {
  onSwitchToSignup: () => void;
};

export default function LoginScreen({ onSwitchToSignup }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const redirectTo = useMemo(() => Linking.createURL('auth/callback'), []);

  const handleLogin = async () => {
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Enter your email address.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!supabase) {
      showModal({ title: "Sign-in isn't set up", message: 'Supabase keys are missing from this build.', icon: 'alert-circle-outline', tone: 'danger' });
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setIsLoading(false);
    if (error) setErrors({ password: error.message.includes('Invalid') ? 'That email and password don’t match.' : error.message });
  };

  const handleGoogle = async () => {
    setIsGoogleLoading(true);
    const result = await signInWithGoogle();
    setIsGoogleLoading(false);
    if (!result.ok && !result.cancelled) showModal({ title: result.title, message: result.message, icon: 'logo-google' });
  };

  const handleForgot = async () => {
    if (!email.trim()) {
      setErrors({ email: 'Enter your email first, then tap “Forgot password?”.' });
      return;
    }
    if (!supabase) return;
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setIsLoading(false);
    if (error) {
      showModal({ title: "Couldn't send the reset email", message: error.message, icon: 'mail-outline', tone: 'danger' });
      return;
    }
    showModal({ title: 'Check your inbox', message: `We sent a reset link to ${email.trim()}.`, icon: 'mail-open-outline' });
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Pick up right where the music left off."
      footer={
        <Pressable onPress={onSwitchToSignup} hitSlop={10} accessibilityRole="button">
          <Text variant="body" color="textSecondary">
            New to RagaStream? <Text variant="bodyStrong" color="accentInk">Create an account</Text>
          </Text>
        </Pressable>
      }
    >
      <GoogleButton label="Continue with Google" onPress={() => void handleGoogle()} loading={isGoogleLoading} disabled={isLoading} />
      <AuthDivider />
      <TextField
        label="Email"
        icon="mail-outline"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
        }}
        error={errors.email}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        icon="lock-closed-outline"
        secure
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
        }}
        error={errors.password}
        placeholder="Your password"
        autoCapitalize="none"
        autoComplete="password"
        returnKeyType="go"
        onSubmitEditing={() => void handleLogin()}
      />
      <View style={{ alignItems: 'flex-end', marginTop: -Space[1] }}>
        <Pressable onPress={() => void handleForgot()} hitSlop={10} accessibilityRole="button">
          <Text variant="captionStrong" color="accentInk">Forgot password?</Text>
        </Pressable>
      </View>
      <Button label="Sign in" size="lg" fullWidth loading={isLoading} disabled={isGoogleLoading} onPress={() => void handleLogin()} />
    </AuthLayout>
  );
}
