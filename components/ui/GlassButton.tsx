import React from 'react';
import { Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { MeshGradient } from './MeshGradient';
import { PressableScale } from './PressableScale';
import { colors, alloyGradient, font, radius } from '@/lib/theme';

interface GlassButtonProps {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  /** 'gradient' = filled alloy gradient (primary). 'glass' = frosted outline. */
  variant?: 'gradient' | 'glass';
  intensity?: number;
  className?: string;
  textClassName?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function GlassButton({
  title,
  onPress,
  disabled = false,
  variant = 'gradient',
  style,
  textStyle,
}: GlassButtonProps) {
  const isGradient = variant === 'gradient';
  return (
    <PressableScale onPress={onPress} disabled={disabled} scaleTo={0.97} style={style}>
      <View style={[styles.button, disabled && { opacity: 0.55 }]}>
        {isGradient ? (
          <MeshGradient colors={alloyGradient} intensity={16} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceStrong }]} />
        )}
        <View style={styles.inner}>
          <Text
            style={[
              styles.label,
              { color: isGradient ? colors.base : colors.platinum },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  inner: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  label: {
    fontFamily: font.bold,
    fontSize: 15.5,
    letterSpacing: 0.2,
  },
});
