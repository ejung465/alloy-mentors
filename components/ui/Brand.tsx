import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { MeshGradient } from './MeshGradient';
import { colors, alloyGradient, font, radius } from '@/lib/theme';

/**
 * The forged "Alloy" mark — a gradient-filled chip with an inset "A" and a
 * diagonal seam line evoking two fused metals.
 */
export function BrandMark({ size = 56, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.35)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <MeshGradient colors={alloyGradient} intensity={18} />
      {/* diagonal alloy seam */}
      <View
        style={{
          position: 'absolute',
          width: size * 1.6,
          height: 1.5,
          backgroundColor: 'rgba(255,255,255,0.35)',
          transform: [{ rotate: '-32deg' }],
        }}
      />
      <Text
        style={{
          fontFamily: font.black,
          fontSize: size * 0.5,
          color: colors.base,
          letterSpacing: -1,
        }}
      >
        A
      </Text>
    </View>
  );
}

/** Full lockup: mark + "Alloy" wordmark + "Mentors" supporting line. */
export function BrandLockup({
  size = 'md',
  showTagline = true,
}: {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}) {
  const markSize = size === 'lg' ? 64 : size === 'sm' ? 40 : 52;
  const wordSize = size === 'lg' ? 34 : size === 'sm' ? 22 : 28;

  return (
    <View style={styles.row}>
      <BrandMark size={markSize} />
      <View style={{ marginLeft: 14 }}>
        <Text style={[styles.word, { fontSize: wordSize }]}>Alloy</Text>
        {showTagline && <Text style={styles.tagline}>Mentors</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { fontFamily: font.black, color: colors.text, letterSpacing: -1 },
  tagline: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: colors.textFaint,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});

export const radii = radius; // re-export convenience
