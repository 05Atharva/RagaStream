/**
 * AppModal — A reusable, globally-accessible modal component.
 *
 * Usage:
 *   import { showModal } from '../components/AppModal';
 *   showModal({ title: 'Oops', message: 'Song already in playlist.', icon: 'alert-circle' });
 *
 * Supports:
 *   - Single action (OK) or dual actions (Cancel / Confirm)
 *   - Custom icons via Ionicons
 *   - Smooth fade + scale animation
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Types ────────────────────────────────────────────────────────────────────

type ModalAction = {
  label: string;
  onPress?: () => void;
  style?: 'default' | 'destructive' | 'cancel';
};

type ModalConfig = {
  title: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  actions?: ModalAction[];
};

// ── Global show/hide ─────────────────────────────────────────────────────────

let _showModalFn: ((config: ModalConfig) => void) | null = null;

export function showModal(config: ModalConfig) {
  if (_showModalFn) {
    _showModalFn(config);
  } else {
    console.warn('[AppModal] Not mounted yet — call showModal after <AppModal /> is rendered.');
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AppModal() {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<ModalConfig | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  const show = useCallback((cfg: ModalConfig) => {
    setConfig(cfg);
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.85, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setConfig(null);
    });
  }, [opacity, scale]);

  useEffect(() => {
    _showModalFn = show;
    return () => {
      _showModalFn = null;
    };
  }, [show]);

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.85);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 8, tension: 65, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, scale]);

  if (!visible || !config) return null;

  const actions = config.actions ?? [{ label: 'OK', style: 'default' as const }];

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={hide}>
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Pressable>
            {/* Icon */}
            {config.icon && (
              <View style={styles.iconWrap}>
                <Ionicons
                  name={config.icon}
                  size={36}
                  color={config.iconColor ?? '#7C3AED'}
                />
              </View>
            )}

            {/* Title */}
            <Text style={styles.title}>{config.title}</Text>

            {/* Message */}
            <Text style={styles.message}>{config.message}</Text>

            {/* Actions */}
            <View style={styles.actions}>
              {actions.map((action, i) => {
                const isDestructive = action.style === 'destructive';
                const isCancel = action.style === 'cancel';
                return (
                  <Pressable
                    key={i}
                    onPress={() => {
                      hide();
                      action.onPress?.();
                    }}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      isCancel && styles.actionBtnCancel,
                      !isCancel && styles.actionBtnPrimary,
                      isDestructive && styles.actionBtnDestructive,
                      pressed && styles.actionBtnPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.actionBtnText,
                        isCancel && styles.actionBtnTextCancel,
                      ]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#1a1c1c',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 360,
    paddingBottom: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    width: '100%',
  },
  iconWrap: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    marginBottom: 16,
    width: 64,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    color: 'rgba(204, 195, 216, 0.85)',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  actionBtnPrimary: {
    backgroundColor: '#7C3AED',
  },
  actionBtnCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
  },
  actionBtnDestructive: {
    backgroundColor: '#C62828',
  },
  actionBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  actionBtnTextCancel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
});
