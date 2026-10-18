import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Motion, Radius, Space } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import Button from './Button';
import Text from './Text';

type EmptyStateProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
};

/**
 * Empty states name what will appear and how to make it appear. The icon
 * lands with a small overshoot (anticipation → settle) so the screen feels
 * intentional rather than broken.
 */
export default function EmptyState({ icon, title, body, actionLabel, onAction, compact = false }: EmptyStateProps) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const pop = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    pop.value = withDelay(
      80,
      withSequence(
        withTiming(1.08, { duration: Motion.duration.glide, easing: Motion.easing.out }),
        withTiming(1, { duration: Motion.duration.quick, easing: Motion.easing.standard })
      )
    );
  }, [pop, reduced]);

  const iconStyle = useAnimatedStyle(() => ({ opacity: Math.min(pop.value, 1), transform: [{ scale: pop.value }] }));

  return (
    <View style={{ alignItems: 'center', gap: Space[3], paddingHorizontal: Space[8], paddingVertical: compact ? Space[6] : Space[12] }}>
      <Animated.View
        style={[
          {
            alignItems: 'center',
            backgroundColor: colors.accentSoft,
            borderRadius: Radius.pill,
            height: compact ? 64 : 84,
            justifyContent: 'center',
            marginBottom: Space[2],
            width: compact ? 64 : 84,
          },
          iconStyle,
        ]}
      >
        <Ionicons name={icon} size={compact ? 28 : 36} color={colors.accentInk} />
      </Animated.View>
      <Text variant="title" align="center">{title}</Text>
      {body ? <Text variant="caption" color="textSecondary" align="center">{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: Space[3] }} />
      ) : null}
    </View>
  );
}
