import React, { useEffect, useState } from 'react';
import { TextStyle, StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedReaction,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

/**
 * Count-up number animation (Reanimated driven). Used for every headline stat
 * so figures spring to life when a screen loads or a value changes.
 */
export function AnimatedCounter({
  value,
  style,
  duration = 900,
  decimals = 0,
  prefix = '',
  suffix = '',
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const progress = useSharedValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, duration, progress]);

  useAnimatedReaction(
    () => progress.value,
    (v) => {
      runOnJS(setDisplay)(v);
    }
  );

  const shown = decimals > 0 ? display.toFixed(decimals) : Math.round(display).toString();

  return (
    <Animated.Text style={style} numberOfLines={1}>
      {prefix}
      {shown}
      {suffix}
    </Animated.Text>
  );
}
