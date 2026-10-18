import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Motion, Radius, Space } from '../../constants/theme';
import { useColors } from '../../theme/ThemeProvider';
import { tapHaptic } from '../../services/haptics';
import Text from './Text';

type Option<T extends string> = { value: T; label: string; icon?: React.ComponentProps<typeof Ionicons>['name'] };

/**
 * Segmented control whose selection pill slides between options with the
 * same inchworm stretch as the tab indicator — one motion vocabulary.
 */
export default function Segmented<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const seg = width / options.length;
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const prev = useSharedValue(index);

  useEffect(() => {
    if (!seg) return;
    const l = seg * index + 3;
    const r = seg * (index + 1) - 3;
    const forward = index > prev.value;
    prev.value = index;
    if (reduced) {
      left.value = l;
      right.value = r;
      return;
    }
    const lead = { duration: 200, easing: Motion.easing.glide };
    const trail = { duration: 280, easing: Motion.easing.out };
    if (forward) {
      right.value = withTiming(r, lead);
      left.value = withDelay(50, withTiming(l, trail));
    } else {
      left.value = withTiming(l, lead);
      right.value = withDelay(50, withTiming(r, trail));
    }
  }, [index, left, prev, reduced, right, seg]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: left.value }], width: Math.max(0, right.value - left.value) }));

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth(w);
        const s = w / options.length;
        left.value = s * index + 3;
        right.value = s * (index + 1) - 3;
      }}
      accessibilityRole="radiogroup"
      style={{ backgroundColor: colors.surfaceRaised, borderRadius: Radius.pill, flexDirection: 'row', height: 44, padding: 3 }}
    >
      <Animated.View style={[{ backgroundColor: colors.surface, borderRadius: Radius.pill, bottom: 3, left: 0, position: 'absolute', top: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, pill]} />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              tapHaptic();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={{ alignItems: 'center', flex: 1, flexDirection: 'row', gap: Space[1], justifyContent: 'center' }}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={selected ? colors.text : colors.textTertiary} /> : null}
            <Text variant="captionStrong" color={selected ? 'text' : 'textTertiary'}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
