import { useRef, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { supabase } from '../services/supabase';
import { signInWithGoogle } from '../services/googleAuth';
import { showModal } from '../components/AppModal';
import AuthDivider from '../components/AuthDivider';
import AuthLayout from '../components/AuthLayout';
import GoogleButton from '../components/GoogleButton';
import Button from '../components/ui/Button';
import Text from '../components/ui/Text';
import TextField from '../components/ui/TextField';

type SignupScreenProps = {
  onSwitchToLogin: () => void;
};

type Errors = { name?: string; email?: string; password?: string; confirm?: string };

export default function SignupScreen({ onSwitchToLogin }: SignupScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const clear = (key: keyof Errors) => errors[key] && setErrors((e) => ({ ...e, [key]: undefined }));

  const handleSignup = async () => {
    const next: Errors = {};
    if (!name.trim()) next.name = 'What should we call you?';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 6) next.password = 'Use at least 6 characters.';
    if (confirm !== password) next.confirm = "The passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    if (!supabase) {
      showModal({ title: "Sign-up isn't set up", message: 'Supabase keys are missing from this build.', icon: 'alert-circle-outline', tone: 'danger' });
      return;
    }
    setIsLoading(true);
    const { error, data } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } });
    setIsLoading(false);
    if (error) {
      setErrors({ email: error.message });
      return;
    }
    if (!data.session) {
      showModal({
        title: 'Confirm your email',
        message: `We sent a link to ${email.trim()}. Open it to finish creating your account.`,
        icon: 'mail-open-outline',
        actions: [{ label: 'Go to sign in', onPress: onSwitchToLogin }],
      });
    }
  };

  const handleGoogle = async () => {
    setIsGoogleLoading(true);
    const result = await signInWithGoogle();
    setIsGoogleLoading(false);
    if (!result.ok && !result.cancelled) showModal({ title: result.title, message: result.message, icon: 'logo-google' });
  };

  return (
    <AuthLayout
      title="Make it yours"
      subtitle="Your playlists, likes and radio, saved to one account."
      footer={
        <Pressable onPress={onSwitchToLogin} hitSlop={10} accessibilityRole="button">
          <Text variant="body" color="textSecondary">
            Already have an account? <Text variant="bodyStrong" color="accentInk">Sign in</Text>
          </Text>
        </Pressable>
      }
    >
      <GoogleButton label="Continue with Google" onPress={() => void handleGoogle()} loading={isGoogleLoading} disabled={isLoading} />
      <AuthDivider />
      <TextField label="Name" icon="person-outline" value={name} onChangeText={(v) => { setName(v); clear('name'); }} error={errors.name}
        placeholder="Aditi" autoComplete="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
      <TextField ref={emailRef} label="Email" icon="mail-outline" value={email} onChangeText={(v) => { setEmail(v); clear('email'); }} error={errors.email}
        placeholder="you@example.com" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()} />
      <TextField ref={passwordRef} label="Password" icon="lock-closed-outline" secure value={password} onChangeText={(v) => { setPassword(v); clear('password'); }}
        error={errors.password} placeholder="At least 6 characters" autoCapitalize="none" autoComplete="new-password" returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()} />
      <TextField ref={confirmRef} label="Confirm password" icon="lock-closed-outline" secure value={confirm} onChangeText={(v) => { setConfirm(v); clear('confirm'); }}
        error={errors.confirm} placeholder="Type it again" autoCapitalize="none" returnKeyType="go" onSubmitEditing={() => void handleSignup()} />
      <Button label="Create account" size="lg" fullWidth loading={isLoading} disabled={isGoogleLoading} onPress={() => void handleSignup()} />
    </AuthLayout>
  );
}
