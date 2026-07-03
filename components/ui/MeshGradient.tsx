import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { tint } from '@/lib/theme';

/**
 * A polished-metal fill built without any native gradient library — a mid-tone
 * body, a bright catch-light band across the top, and a darker pool at the
 * bottom, blurred together so it reads like light gliding over brushed metal.
 * Used for primary buttons, the FAB, and the brand mark.
 */
export function MeshGradient({
  colors,
  intensity = 20,
  style,
  blobAlpha = 1,
}: {
  colors: readonly [string, string] | readonly [string, string, string];
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  blobAlpha?: number;
}) {
  const light = colors[0];
  const dark = colors[colors.length - 1] as string;
  const mid = (colors.length === 3 ? colors[1] : colors[0]) as string;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]} pointerEvents="none">
      {/* mid-tone metal body */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint(mid, blobAlpha) }]} />
      {/* dark pool at the bottom */}
      <View
        style={{
          position: 'absolute',
          left: -40,
          right: -40,
          bottom: -60,
          height: 150,
          borderRadius: 80,
          backgroundColor: tint(dark, blobAlpha),
        }}
      />
      {/* bright catch-light streak near the top */}
      <View
        style={{
          position: 'absolute',
          left: -40,
          right: -40,
          top: -70,
          height: 120,
          borderRadius: 70,
          backgroundColor: tint(light, blobAlpha),
        }}
      />
      <BlurView intensity={intensity} tint="light" style={StyleSheet.absoluteFill} />
    </View>
  );
}
