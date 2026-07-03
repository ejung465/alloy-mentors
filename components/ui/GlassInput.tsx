import React, { useState } from 'react';
import { TextInput, TextInputProps, View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, font, radius } from '@/lib/theme';

interface GlassInputProps extends TextInputProps {
  label?: string;
  containerClassName?: string;
  dark?: boolean;
}

const AnimatedView = Animated.View;

/**
 * Frosted text field with an animated alloy focus-glow border.
 */
export function GlassInput({ label, style, onFocus, onBlur, ...props }: GlassInputProps) {
  const [focused, setFocused] = useState(false);
  const f = useSharedValue(0);

  const wrapStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(f.value, [0, 1], [colors.hairline, colors.platinum]),
    shadowOpacity: f.value * 0.25,
  }));

  return (
    <View style={{ width: '100%' }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <AnimatedView style={[styles.inputWrapper, wrapStyle]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceStrong }]} />
        <TextInput
          placeholderTextColor={colors.textGhost}
          selectionColor={colors.platinum}
          style={[styles.input, style]}
          onFocus={(e) => {
            setFocused(true);
            f.value = withTiming(1, { duration: 220 });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            f.value = withTiming(0, { duration: 220 });
            onBlur?.(e);
          }}
          {...props}
        />
      </AnimatedView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: colors.silver,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    minHeight: 54,
    justifyContent: 'center',
    shadowColor: colors.platinum,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
  },
  input: {
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.text,
    paddingHorizontal: 18,
    minHeight: 54,
    zIndex: 10,
  },
});
