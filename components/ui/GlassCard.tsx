import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { colors, radius, motion, raised } from '@/lib/theme';

interface GlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Accent used for the soft press wash when pressable. */
  rippleColor?: string;
}

/**
 * Editorial paper card: a solid warm-ivory tile with a thin pine hairline and a
 * soft warm lift. Flat and calm — no blur, no metallic catch-light. Reanimated
 * spring-press when interactive.
 */
export function GlassCard({
  children,
  style,
  contentStyle,
  onPress,
  rippleColor = colors.platinum,
}: GlassCardProps) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  const fire = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  const tap = Gesture.Tap()
    .enabled(!!onPress)
    .maxDuration(100000)
    .onBegin(() => {
      scale.value = withSpring(0.985, motion.press);
      glow.value = withSpring(1, motion.soft);
    })
    .onFinalize((_e, success) => {
      scale.value = withSpring(1, motion.press);
      glow.value = withSpring(0, motion.soft);
      if (success && onPress) runOnJS(fire)();
    });

  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value * 0.06 }));

  const body = (
    <View style={[styles.card, style]}>
      {onPress && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, glowStyle, { backgroundColor: rippleColor }]}
        />
      )}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );

  if (onPress) {
    return (
      <GestureDetector gesture={tap}>
        <Animated.View style={aStyle}>{body}</Animated.View>
      </GestureDetector>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    marginBottom: 12,
    ...raised,
  },
  content: {
    padding: 18,
    zIndex: 10,
  },
});
