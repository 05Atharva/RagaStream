import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  backgroundColor?: string;
};

export default function AnimatedBottomSheet({
  isVisible,
  onClose,
  children,
  backgroundColor = '#1a1c1c',
}: Props) {
  const { height: screenHeight } = useWindowDimensions();
  const [isMounted, setIsMounted] = useState(false);

  // Shared value so worklets can read/write without crossing threads
  const sheetHeight = useSharedValue(screenHeight);
  const backdropOpacity = useSharedValue(0);
  const translateY = useSharedValue(screenHeight);

  // Keep onClose stable across renders so worklet callbacks don't go stale
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const callOnClose = useCallback(() => { onCloseRef.current(); }, []);

  // Animate the sheet out, then call setIsMounted(false).
  // withNotify=true → also call onClose (user-initiated close).
  // withNotify=false → parent already knows (external isVisible=false).
  const animateClose = useCallback(
    (withNotify: boolean) => {
      backdropOpacity.value = withTiming(0, { duration: 250 });
      translateY.value = withTiming(
        sheetHeight.value,
        { duration: 250, easing: Easing.in(Easing.ease) },
        (finished) => {
          if (!finished) return;
          runOnJS(setIsMounted)(false);
          if (withNotify) runOnJS(callOnClose)();
        }
      );
    },
    [backdropOpacity, callOnClose, sheetHeight, translateY]
  );

  // Mount when isVisible flips true; animate out on external false.
  // isMounted intentionally omitted from deps — adding it causes open loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isVisible) {
      setIsMounted(true);
    } else if (isMounted) {
      animateClose(false);
    }
  }, [isVisible, animateClose]);

  // Enter animation fires once the Modal has rendered (isMounted→true).
  useEffect(() => {
    if (!isMounted) return;
    translateY.value = screenHeight;
    backdropOpacity.value = 0;
    backdropOpacity.value = withTiming(0.6, { duration: 300 });
    translateY.value = withSpring(0, { damping: 25, stiffness: 200 });
  }, [isMounted, backdropOpacity, screenHeight, translateY]);

  // Drag handle only — keeps FlatList / DraggableFlatList scrollable inside.
  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((event) => {
      translateY.value = Math.max(0, event.translationY);
      backdropOpacity.value = Math.max(
        0,
        0.6 * (1 - event.translationY / sheetHeight.value)
      );
    })
    .onEnd((event) => {
      const shouldClose =
        event.velocityY > 500 || translateY.value > sheetHeight.value * 0.3;
      if (shouldClose) {
        backdropOpacity.value = withTiming(0, { duration: 250 });
        translateY.value = withTiming(
          sheetHeight.value,
          { duration: 250, easing: Easing.in(Easing.ease) },
          (finished) => {
            if (!finished) return;
            runOnJS(setIsMounted)(false);
            runOnJS(callOnClose)();
          }
        );
      } else {
        translateY.value = withSpring(0, { damping: 25, stiffness: 200 });
        backdropOpacity.value = withTiming(0.6, { duration: 200 });
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isMounted) return null;

  return (
    <Modal
      transparent
      visible={isMounted}
      onRequestClose={() => animateClose(true)}
      animationType="none"
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.overlay}>
        {/* Backdrop — tap closes sheet */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => animateClose(true)}>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, styles.backdrop, backdropStyle]}
          />
        </Pressable>

        {/* Sheet panel */}
        <Animated.View
          style={[styles.sheet, { backgroundColor }, sheetStyle]}
          onLayout={(e) => { sheetHeight.value = e.nativeEvent.layout.height; }}
        >
          {/* Draggable handle — gesture only here, not on content */}
          <GestureDetector gesture={panGesture}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingBottom: 8,
    paddingTop: 12,
  },
  handle: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    height: 4,
    width: 40,
  },
});
