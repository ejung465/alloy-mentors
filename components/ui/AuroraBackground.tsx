import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { colors, tint } from '@/lib/theme';

/**
 * The calm Alloy backdrop: a warm cream field with two very soft sage/pine
 * washes drifting slowly beneath. Editorial and quiet — no glass, no facets,
 * no heavy blur. Pure Reanimated, no native deps.
 */
function Blob({
  color,
  size,
  startX,
  startY,
  travelX,
  travelY,
  duration,
  maxOpacity = 0.5,
}: {
  color: string;
  size: number;
  startX: number;
  startY: number;
  travelX: number;
  travelY: number;
  duration: number;
  maxOpacity?: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [duration, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [startX, startX + travelX]) },
      { translateY: interpolate(t.value, [0, 1], [startY, startY + travelY]) },
      { scale: interpolate(t.value, [0, 1], [1, 1.18]) },
    ],
    opacity: interpolate(t.value, [0, 1], [maxOpacity * 0.55, maxOpacity]),
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function AuroraBackground({ variant = 'default' }: { variant?: 'default' | 'iris' | 'warm' }) {
  const { width, height } = useWindowDimensions();

  // A single soft accent wash, shifted subtly by variant so different surfaces
  // feel distinct without leaving the harbor family.
  const accent =
    variant === 'warm' ? '#E8B48C' : variant === 'iris' ? '#9FC0CE' : colors.titanium;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* gray-white paper ground */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.base }]} />
      {/* soft gray wash, upper-left */}
      <Blob color={tint('#C4C4C4', 0.22)} size={width * 1.1} startX={-width * 0.3} startY={-height * 0.1} travelX={width * 0.22} travelY={height * 0.12} duration={22000} maxOpacity={0.5} />
      {/* faint blue wash, lower-right, for quiet depth */}
      <Blob color={tint('#9CA8AC', 0.18)} size={width * 0.95} startX={width * 0.4} startY={height * 0.62} travelX={-width * 0.2} travelY={-height * 0.1} duration={26000} maxOpacity={0.42} />
      {/* the variant accent, kept very subtle */}
      <Blob color={tint(accent, 0.16)} size={width * 0.85} startX={width * 0.1} startY={height * 0.3} travelX={width * 0.16} travelY={height * 0.1} duration={24000} maxOpacity={0.34} />
      {/* faint warm veil unifies the field into calm paper */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(242,236,222,0.30)' }]} />
    </View>
  );
}
