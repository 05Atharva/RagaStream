import { View } from 'react-native';
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAccess } from '../hooks/useAccess';
import { gateView } from '../services/accessGate';
import { supabase } from '../services/supabase';
import { useColors } from '../theme/ThemeProvider';
import AccessPendingScreen from '../screens/AccessPendingScreen';
import { MeendMark } from './Logo';

/**
 * Between "signed in" and "the app": asks the backend whether the owner has
 * approved this account. Approved renders `children`; pending, declined and
 * unreachable show the waiting screen; the first check shows the Meend mark,
 * never a flash of the app.
 */
export default function AccessGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const email = useAuthStore((s) => s.session?.user?.email);
  const query = useAccess();
  const view = gateView(query);

  if (view === 'app') return <>{children}</>;

  if (view === 'loading') {
    return (
      <View style={{ alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center' }}>
        <MeendMark size={64} animate />
      </View>
    );
  }

  return (
    <AccessPendingScreen
      kind={view}
      email={query.data?.email || email}
      checking={query.isFetching}
      onCheck={() => void query.refetch()}
      onSignOut={() => void supabase?.auth.signOut().catch(() => {})}
    />
  );
}
