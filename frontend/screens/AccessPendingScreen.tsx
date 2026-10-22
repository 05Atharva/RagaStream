import { View } from 'react-native';
import AuthLayout from '../components/AuthLayout';
import Button from '../components/ui/Button';

export type AccessScreenKind = 'pending' | 'rejected' | 'unreachable';

type Props = {
  kind: AccessScreenKind;
  email?: string | null;
  /** True while a check is running (shows the spinner on the button). */
  checking?: boolean;
  onCheck: () => void;
  onSignOut: () => void;
};

/**
 * Shown to a signed-in account the owner hasn't approved yet (or has declined),
 * and when the backend can't be reached to ask. Same frame as sign-in.
 * One primary action: Check again / Sign out / Retry.
 */
export default function AccessPendingScreen({ kind, email, checking = false, onCheck, onSignOut }: Props) {
  if (kind === 'rejected') {
    return (
      <AuthLayout
        title="This account isn't approved"
        subtitle="Ask the owner for access, or sign in with a different account."
        footer={<View />}
      >
        <Button label="Sign out" size="lg" fullWidth onPress={onSignOut} />
      </AuthLayout>
    );
  }

  const unreachable = kind === 'unreachable';
  return (
    <AuthLayout
      title={unreachable ? "Can't reach RagaStream" : "You're on the list"}
      subtitle={
        unreachable
          ? "We couldn't check your account. Check your connection, then try again."
          : `We've asked the owner to let you in. You'll get an email at ${email || 'your address'} when you're approved.`
      }
      footer={<Button label="Sign out" variant="ghost" onPress={onSignOut} />}
    >
      <Button label={unreachable ? 'Retry' : 'Check again'} size="lg" fullWidth loading={checking} onPress={onCheck} />
    </AuthLayout>
  );
}
