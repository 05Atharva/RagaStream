import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Layout, Motion, Radius, Space } from '../constants/theme';
import { useColors } from '../theme/ThemeProvider';
import { usePressMotion } from '../motion/primitives';
import { tapHaptic } from '../services/haptics';
import { usePlayerStore } from '../store/playerStore';
import Text from './ui/Text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const ICONS: Record<string, { on: IconName; off: IconName; label: string }> = {
  Home: { on: 'home', off: 'home-outline', label: 'Home' },
  Search: { on: 'search', off: 'search-outline', label: 'Search' },
  Library: { on: 'albums', off: 'albums-outline', label: 'Library' },
};

const INDICATOR_W = 20;

function TabItem({ label, icon, focused, onPress }: { label: string; icon: IconName; focused: boolean; onPress: () => void }) {
  const colors = useColors();
  const press = usePressMotion(0.88);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={{ alignItems: 'center', flex: 1, height: Layout.tabBarHeight, justifyContent: 'center' }}
    >
      <Animated.View style={[{ alignItems: 'center', gap: 3 }, press.style]}>
        <Ionicons name={icon} size={23} color={focused ? colors.text : colors.textTertiary} />
        <Text variant="label" color={focused ? 'text' : 'textTertiary'} style={{ letterSpacing: 0.4, textTransform: 'none' }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Tab bar that fades into the content above it. The Kesar indicator moves
 * like an inchworm: the leading edge leaves first and the trailing edge
 * catches up, so it stretches mid-flight and settles on arrival
 * (squash & stretch + follow-through).
 */
export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const hasMiniPlayer = usePlayerStore((s) => s.currentTrack !== null);
  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = barWidth / state.routes.length;
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const prevIndex = useRef(state.index);

  useEffect(() => {
    if (!tabWidth) return;
    const center = tabWidth * state.index + tabWidth / 2;
    const l = center - INDICATOR_W / 2;
    const r = center + INDICATOR_W / 2;
    const movingRight = state.index > prevIndex.current;
    prevIndex.current = state.index;
    if (reduced) {
      left.value = l;
      right.value = r;
      return;
    }
    const lead = { duration: 220, easing: Motion.easing.glide };
    const trail = { duration: 300, easing: Motion.easing.out };
    if (movingRight) {
      right.value = withTiming(r, lead);
      left.value = withDelay(70, withTiming(l, trail));
    } else {
      left.value = withTiming(l, lead);
      right.value = withDelay(70, withTiming(r, trail));
    }
  }, [left, reduced, right, state.index, tabWidth]);

  // First layout: place without animating.
  const onLayout = (w: number) => {
    setBarWidth(w);
    const tw = w / state.routes.length;
    const center = tw * state.index + tw / 2;
    left.value = center - INDICATOR_W / 2;
    right.value = center + INDICATOR_W / 2;
  };

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: left.value }],
    width: Math.max(INDICATOR_W * 0.6, right.value - left.value),
  }));

  // The fade extends behind the mini player so it floats on the same wash.
  const fadeHeight = Layout.tabBarHeight + insets.bottom + (hasMiniPlayer ? Layout.miniPlayerHeight + Space[4] : Space[6]);

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <LinearGradient
        pointerEvents="none"
        colors={[colors.fadeTop, colors.fadeBottom, colors.bg]}
        locations={[0, 0.45, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fadeHeight }}
      />
      <View
        onLayout={(e) => onLayout(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', paddingBottom: insets.bottom }}
        accessibilityRole="tablist"
      >
        {state.routes.map((route, index) => {
          const meta = ICONS[route.name] ?? { on: 'ellipse', off: 'ellipse-outline', label: route.name };
          const focused = state.index === index;
          return (
            <TabItem
              key={route.key}
              label={meta.label}
              icon={focused ? meta.on : meta.off}
              focused={focused}
              onPress={() => {
                tapHaptic();
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
            />
          );
        })}
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 4, left: 0, height: 3, borderRadius: Radius.pill, backgroundColor: colors.accent },
            indicatorStyle,
          ]}
        />
      </View>
    </View>
  );
}
