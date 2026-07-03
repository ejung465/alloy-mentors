import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { motion } from '@/lib/theme';

/**
 * Premium press primitive — Gesture Handler + Reanimated spring physics with
 * an optional haptic tap. Replaces the legacy Animated.spring press wrappers
 * scattered across the app.
 */
export function PressableScale({
  children,
  onPress,
  style,
  scaleTo = 0.96,
  haptic = true,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);

  const fire = () => {
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(100000)
    .onBegin(() => {
      scale.value = withSpring(scaleTo, motion.press);
    })
    .onFinalize((_e, success) => {
      scale.value = withSpring(1, motion.press);
      if (success && onPress) runOnJS(fire)();
    });

  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[style, aStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}
