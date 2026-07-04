import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  onRetry: () => void;
};

export default function OfflineState({ onRetry }: Props) {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -10,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [floatAnim]);

  return (
    <View style={styles.container}>
      {/* Ambient purple glow — sits behind all content */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.glowLayer]}>
        <View style={styles.glowOrb} />
      </View>

      {/* Icon */}
      <Animated.View style={[styles.iconCircle, { transform: [{ translateY: floatAnim }] }]}>
        <Ionicons name="cloud-offline-outline" size={60} color="rgba(204,195,216,0.8)" />
      </Animated.View>

      <Text style={styles.title}>You're offline</Text>
      <Text style={styles.subtitle}>
        Check your connection and try again to keep the music playing.
      </Text>

      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed]}
      >
        <Ionicons name="refresh" size={16} color="#ede0ff" />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },

  // ── Glow ──
  glowLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowOrb: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderRadius: 180,
    elevation: 0,
    height: 360,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 80,
    width: 360,
  },

  // ── Icon circle ──
  iconCircle: {
    alignItems: 'center',
    backgroundColor: '#1e2020',
    borderColor: 'rgba(255,255,255,0.05)',
    borderRadius: 64,
    borderWidth: 1,
    height: 128,
    justifyContent: 'center',
    marginBottom: 32,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    width: 128,
  },

  // ── Copy ──
  title: {
    color: '#e2e2e2',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(204,195,216,0.85)',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    marginBottom: 40,
    maxWidth: 280,
    textAlign: 'center',
  },

  // ── Retry button ──
  retryBtn: {
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 40,
    paddingVertical: 16,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  retryBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  retryText: {
    color: '#ede0ff',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.48,
  },
});
