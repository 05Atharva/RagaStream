/**
 * AppModal — the app's dialog. Replaces native Alert so confirmations match
 * the brand in both themes.
 *
 *   showModal({ title: 'Delete playlist?', message: '…', tone: 'danger',
 *     actions: [{ label: 'Cancel', style: 'cancel' }, { label: 'Delete', style: 'destructive', onPress }] })
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { Motion, Radius, Space } from '../constants/theme';
import { makeStyles, useColors } from '../theme/ThemeProvider';
import Button from './ui/Button';
import Text from './ui/Text';

export type ModalAction = {
  label: string;
  onPress?: () => void;
  style?: 'default' | 'destructive' | 'cancel';
};

export type ModalConfig = {
  title: string;
  message: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: 'default' | 'danger';
  actions?: ModalAction[];
};

const useModalStore = create<{ config: ModalConfig | null }>(() => ({ config: null }));

export function showModal(config: ModalConfig) {
  useModalStore.setState({ config });
}

/** Two-button confirmation with the destructive action on the right. */
export function confirmModal(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  icon?: ModalConfig['icon'];
}) {
  showModal({
    title: opts.title,
    message: opts.message,
    icon: opts.icon,
    tone: opts.destructive ? 'danger' : 'default',
    actions: [
      { label: 'Cancel', style: 'cancel' },
      { label: opts.confirmLabel, style: opts.destructive ? 'destructive' : 'default', onPress: opts.onConfirm },
    ],
  });
}

export default function AppModal() {
  const styles = useStyles();
  const colors = useColors();
  const reduced = useReducedMotion();
  const config = useModalStore((s) => s.config);
  const [shown, setShown] = useState<ModalConfig | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (config) {
      setShown(config);
      progress.value = 0;
      progress.value = withTiming(1, { duration: Motion.duration.glide, easing: Motion.easing.out });
    }
  }, [config, progress]);

  const close = (after?: () => void) => {
    progress.value = withTiming(0, { duration: Motion.duration.quick, easing: Motion.easing.in }, (done) => {
      if (done) {
        runOnJS(setShown)(null);
        if (after) runOnJS(after)();
      }
    });
    useModalStore.setState({ config: null });
  };

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduced
      ? []
      : [{ translateY: (1 - progress.value) * 16 }, { scale: 0.96 + progress.value * 0.04 }],
  }));

  if (!shown) return null;
  const actions = shown.actions ?? [{ label: 'OK', style: 'default' as const }];
  const accent = shown.tone === 'danger' ? colors.danger : colors.accentInk;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => close()}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, scrimStyle]}>
          <Pressable style={{ flex: 1 }} onPress={() => close()} accessibilityLabel="Dismiss" />
        </Animated.View>
        <Animated.View style={[styles.card, cardStyle]} accessibilityViewIsModal>
          {shown.icon ? (
            <View style={[styles.iconWrap, { backgroundColor: shown.tone === 'danger' ? colors.dangerSoft : colors.accentSoft }]}>
              <Ionicons name={shown.icon} size={26} color={accent} />
            </View>
          ) : null}
          <Text variant="title" accessibilityRole="header">{shown.title}</Text>
          <Text variant="body" color="textSecondary">{shown.message}</Text>
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                size="md"
                variant={action.style === 'cancel' ? 'secondary' : action.style === 'destructive' ? 'danger' : 'primary'}
                onPress={() => close(action.onPress)}
                style={styles.action}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, justifyContent: 'center', padding: Space[6] },
  scrim: { ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, backgroundColor: t.colors.scrim },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: Radius.xl,
    gap: Space[3],
    padding: Space[6],
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 52,
    justifyContent: 'center',
    marginBottom: Space[1],
    width: 52,
  },
  actions: { flexDirection: 'row', gap: Space[3], marginTop: Space[3] },
  action: { flex: 1 },
}));
