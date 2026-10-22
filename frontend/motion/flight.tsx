/**
 * Glide flight — RagaStream's signature motion.
 *
 * When a song is queued, its artwork lifts off the row and travels on an arc
 * (a quadratic Bézier: up, then down into the mini player) like a meend
 * gliding between two notes. The mini player "catches" it with a small bump.
 * The user sees where the song went, which is the point: orientation.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type View as ViewType } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { create } from 'zustand';
import { Motion, Radius } from '../constants/theme';

export type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type Flight = { id: number; from: Rect; image: string; target: Point };
type Measurer = (done: (point: Point) => void) => void;

type FlightStore = {
  flights: Flight[];
  arrivals: number;
};

const useFlightStore = create<FlightStore>(() => ({ flights: [], arrivals: 0 }));
let flightId = 0;
let measureTarget: Measurer | null = null;

/**
 * The mini player registers how to measure its landing point. Measured at
 * launch time, so the target is right even mid-animation or after rotation.
 */
export function setFlightTarget(measurer: Measurer | null) {
  measureTarget = measurer;
}

/** Increments each time a flight lands — the mini player bumps on change. */
export function useFlightArrivals() {
  return useFlightStore((s) => s.arrivals);
}

/** Launch from a measured rect (window coordinates). */
export function launchFlight(from: Rect, image: string) {
  if (!image || from.width <= 0 || !measureTarget) return;
  measureTarget((target) => {
    useFlightStore.setState((s) => ({ flights: [...s.flights, { id: ++flightId, from, image, target }] }));
  });
}

/** Measure a view and launch from it. */
export function launchFlightFrom(ref: React.RefObject<ViewType | null>, image: string) {
  ref.current?.measureInWindow((x, y, width, height) => launchFlight({ x, y, width, height }, image));
}

function land(id: number) {
  useFlightStore.setState((s) => ({ flights: s.flights.filter((f) => f.id !== id), arrivals: s.arrivals + 1 }));
}

const FLIGHT_MS = 620;
const LAND_SIZE = 30;

function FlightSprite({ flight }: { flight: Flight }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const { from, target } = flight;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  // Control point: above the higher of the two ends, biased toward the target,
  // so the path lifts before it falls (an arc, not a slide).
  const control = {
    x: start.x + (target.x - start.x) * 0.6,
    y: Math.min(start.y, target.y) - 140,
  };

  useEffect(() => {
    t.value = withTiming(1, { duration: reduced ? 1 : FLIGHT_MS, easing: Motion.easing.glide }, (done) => {
      if (done) runOnJS(land)(flight.id);
    });
  }, [flight.id, reduced, t]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const inv = 1 - p;
    const x = inv * inv * start.x + 2 * inv * p * control.x + p * p * target.x;
    const y = inv * inv * start.y + 2 * inv * p * control.y + p * p * target.y;
    const size = from.width + (LAND_SIZE - from.width) * p;
    // Tilt into the curve, then level out on landing (arcs principle).
    const tilt = Math.sin(p * Math.PI) * -10;
    return {
      width: size,
      height: size,
      opacity: p > 0.88 ? (1 - p) / 0.12 : 1,
      transform: [{ translateX: x - size / 2 }, { translateY: y - size / 2 }, { rotate: `${tilt}deg` }],
    };
  });

  return (
    <Animated.View style={[styles.sprite, style]}>
      <Image source={{ uri: flight.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}

/** Mounted once at the app root, above navigation. */
export function FlightLayer() {
  const flights = useFlightStore((s) => s.flights);
  if (!flights.length) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flights.map((f) => (
        <FlightSprite key={f.id} flight={f} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: {
    borderRadius: Radius.sm,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    top: 0,
    elevation: 12,
  },
});
