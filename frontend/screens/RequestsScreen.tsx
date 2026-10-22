import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { confirmModal } from '../components/AppModal';
import SkeletonLoader from '../components/SkeletonLoader';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import SectionHeader from '../components/ui/SectionHeader';
import Text from '../components/ui/Text';
import Rise from '../motion/Rise';
import { useAccessRequests, useDecideRequest } from '../hooks/useAccessRequests';
import {
  isNotOwner,
  pendingSubtitle,
  providerLabel,
  timeAgo,
  type DecidedRequest,
  type PendingRequest,
} from '../services/accessRequests';
import Toast from '../services/toast';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Elevation, Layout, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';

function Avatar({ email }: { email: string | null }) {
  const styles = useStyles();
  return (
    <View style={styles.avatar} accessible={false}>
      <Text variant="headline" color="textSecondary">{(email ?? '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function PendingRow({
  item,
  index,
  onApprove,
  onDecline,
}: {
  item: PendingRequest;
  index: number;
  onApprove: (r: PendingRequest) => void;
  onDecline: (r: PendingRequest) => void;
}) {
  const styles = useStyles();
  const who = item.email ?? 'this person';
  return (
    <Rise index={index} style={styles.card}>
      <View style={styles.rowTop}>
        <Avatar email={item.email} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{item.email ?? 'Unknown email'}</Text>
          <Text variant="mono" color="textSecondary" numberOfLines={1}>
            {`${providerLabel(item.provider)} · ${timeAgo(item.requested_at)}`}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button label="Decline" variant="ghost" accessibilityLabel={`Decline ${who}`} onPress={() => onDecline(item)} />
        <Button label="Approve" variant="secondary" icon="checkmark" accessibilityLabel={`Approve ${who}`} onPress={() => onApprove(item)} />
      </View>
    </Rise>
  );
}

function RecentRow({ item, index, onChange }: { item: DecidedRequest; index: number; onChange: (r: DecidedRequest) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const approved = item.status === 'approved';
  const who = item.email ?? 'this person';
  const when = timeAgo(item.decided_at);
  return (
    <Rise index={index} style={styles.recentRow}>
      <Avatar email={item.email} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" numberOfLines={1}>{item.email ?? 'Unknown email'}</Text>
        <View style={styles.statusLine}>
          <View style={[styles.chip, { backgroundColor: approved ? colors.signalSoft : colors.surfaceRaised }]}>
            <Text variant="captionStrong" color={approved ? 'signal' : 'textTertiary'}>{approved ? 'Approved' : 'Declined'}</Text>
          </View>
          {when ? <Text variant="mono" color="textTertiary">{when}</Text> : null}
        </View>
      </View>
      <Button
        label="Change"
        variant="ghost"
        accessibilityLabel={`Change decision for ${who}, currently ${approved ? 'approved' : 'declined'}`}
        onPress={() => onChange(item)}
      />
    </Rise>
  );
}

function Skeleton() {
  const styles = useStyles();
  return (
    <View style={{ gap: Space[3] }} accessibilityLabel="Loading requests">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <View style={styles.rowTop}>
            <SkeletonLoader width={40} height={40} borderRadius={Radius.pill} />
            <View style={{ flex: 1, gap: Space[2] }}>
              <SkeletonLoader width="70%" height={16} />
              <SkeletonLoader width="40%" height={12} />
            </View>
          </View>
          <SkeletonLoader width="100%" height={44} borderRadius={Radius.pill} />
        </View>
      ))}
    </View>
  );
}

export default function RequestsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const styles = useStyles();
  const q = useAccessRequests({ live: true });
  const decide = useDecideRequest();
  const [refreshing, setRefreshing] = useState(false);

  const pending = q.data?.pending ?? [];
  const recent = q.data?.recent ?? [];
  const notOwner = (!q.isOwner && !q.accessLoading) || isNotOwner(q.error);
  const { refetch } = q;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const approve = (r: PendingRequest) => {
    decide.mutate({ userId: r.user_id, email: r.email, action: 'approve' });
    Toast.show({ type: 'success', text1: `Approved ${r.email ?? 'this person'}` });
  };
  const decline = (r: PendingRequest) =>
    confirmModal({
      title: `Decline ${r.email ?? 'this person'}?`,
      message: "They won't be able to use RagaStream. You can change this later.",
      confirmLabel: 'Decline',
      destructive: true,
      icon: 'close-circle-outline',
      onConfirm: () => {
        decide.mutate({ userId: r.user_id, email: r.email, action: 'reject' });
        Toast.show({ type: 'info', text1: `Declined ${r.email ?? 'this person'}` });
      },
    });
  const change = (r: DecidedRequest) => {
    const toApprove = r.status !== 'approved';
    const who = r.email ?? 'this person';
    confirmModal({
      title: toApprove ? `Approve ${who}?` : `Decline ${who}?`,
      message: toApprove
        ? 'They will be able to use RagaStream.'
        : "They won't be able to use RagaStream. You can change this later.",
      confirmLabel: toApprove ? 'Approve' : 'Decline',
      destructive: !toApprove,
      icon: toApprove ? 'checkmark-circle-outline' : 'close-circle-outline',
      onConfirm: () => {
        decide.mutate({ userId: r.user_id, email: r.email, action: toApprove ? 'approve' : 'reject' });
        Toast.show({ type: toApprove ? 'success' : 'info', text1: `${toApprove ? 'Approved' : 'Declined'} ${who}` });
      },
    });
  };

  let body: React.ReactNode;
  let subtitle: string | undefined;
  if (notOwner) {
    body = <EmptyState icon="lock-closed-outline" title="Only the owner can see requests" />;
  } else if (q.isError && !q.data) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load requests"
        body="Check your connection, then try again."
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  } else if (!q.data) {
    body = <Skeleton />;
  } else {
    subtitle = pendingSubtitle(pending.length);
    body = (
      <View style={{ gap: Space[6] }}>
        {pending.length === 0 ? (
          <EmptyState
            compact
            icon="hourglass-outline"
            title="No one's waiting"
            body="When someone signs up, you'll get an email and they'll appear here."
          />
        ) : (
          <View style={{ gap: Space[3] }}>
            {pending.map((r, i) => (
              <PendingRow key={r.user_id} item={r} index={i} onApprove={approve} onDecline={decline} />
            ))}
          </View>
        )}
        {recent.length > 0 ? (
          <View>
            <SectionHeader title="Recent" inset={0} />
            <View style={styles.group}>
              {recent.map((r, i) => (
                <RecentRow key={r.user_id} item={r} index={i} onChange={change} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" onPress={() => navigation.goBack()} accessibilityLabel="Back" iconSize={26} />
        <View style={{ width: Layout.touchTarget }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ gap: 2 }}>
          <Text variant="display" accessibilityRole="header">Requests</Text>
          {subtitle ? <Text variant="body" color="textSecondary">{subtitle}</Text> : null}
        </View>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space[2], paddingVertical: Space[1] },
  content: { gap: Space[6], paddingBottom: Space[16], paddingHorizontal: Layout.gutter, paddingTop: Space[2] },
  card: { backgroundColor: t.colors.surface, borderRadius: Radius.lg, gap: Space[3], padding: Space[4], ...(t.isDark ? {} : Elevation.card) },
  rowTop: { alignItems: 'center', flexDirection: 'row', gap: Space[3] },
  actions: { alignItems: 'center', flexDirection: 'row', gap: Space[2], justifyContent: 'flex-end' },
  avatar: { alignItems: 'center', backgroundColor: t.colors.surfaceRaised, borderRadius: Radius.pill, height: 40, justifyContent: 'center', width: 40 },
  group: { backgroundColor: t.colors.surface, borderRadius: Radius.lg, overflow: 'hidden', ...(t.isDark ? {} : Elevation.card) },
  recentRow: { alignItems: 'center', flexDirection: 'row', gap: Space[3], minHeight: 64, paddingHorizontal: Space[4], paddingVertical: Space[3] },
  statusLine: { alignItems: 'center', flexDirection: 'row', gap: Space[2] },
  chip: { borderRadius: Radius.pill, paddingHorizontal: Space[2], paddingVertical: 2 },
}));
