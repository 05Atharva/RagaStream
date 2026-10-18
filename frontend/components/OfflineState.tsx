import React from 'react';
import { View } from 'react-native';
import { useColors } from '../theme/ThemeProvider';
import EmptyState from './ui/EmptyState';

type Props = {
  onRetry: () => void;
};

/** Full-screen offline state over the tab content (the mini player stays usable). */
export default function OfflineState({ onRetry }: Props) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
      <EmptyState
        icon="cloud-offline-outline"
        title="You're offline"
        body="Check your Wi-Fi or mobile data. Your library and queue will be right here when you're back."
        actionLabel="Try again"
        onAction={onRetry}
      />
    </View>
  );
}
