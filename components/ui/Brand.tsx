import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp, Image } from 'react-native';
import { colors, font, radius } from '@/lib/theme';

/** The Alloy Mentors mark — the actual app logo on its harbor-blue ground. */
export function BrandMark({ size = 56, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          overflow: 'hidden',
          backgroundColor: '#165B74',
        },
        style,
      ]}
    >
      <Image
        source={require('@/assets/images/splash-icon.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
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
