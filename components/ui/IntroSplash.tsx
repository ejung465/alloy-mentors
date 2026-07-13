import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Rect,
  RuntimeShader,
  Skia,
  Text as SkiaText,
  useFont,
  useImage,
} from '@shopify/react-native-skia';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const PINE = '#165B74';
const CREAM = '#F4F6F6';

const LARGE = 208; // the big centered "A" on open
const MID = 96;    // "smaller A than the original logo, not text-small"
const GAP = 10;
const LLOY_SIZE = 30;
const MENTORS_SIZE = 11.5;

// Deliberately slow — this is a premium brand beat, not tied to load time.
const T = {
  hold: 500,          // beat on the big centered mark
  resolve: 1500,       // shrink + "lloy" emerges from center
  mentorsDelay: 950,   // "Mentors" starts partway through resolve — overlapping
  mentorsDur: 850,
  settle: 1000,        // hold the finished, centered lockup
  dissolve: 2000,       // fine-grain dust disintegration
};

// Per-pixel noise dissolve applied to the WHOLE composed scene (background +
// mark + wordmark) at once, via RuntimeShader as the first child of the
// Group it filters. Grain is sampled at native pixel frequency — a fine,
// sand-like disintegration rather than discrete visible particles — with a
// soft warm glow riding the dissolve boundary.
const dissolveSource = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float progress;

float hash(float2 p) {
  float3 p3 = fract(p.xyx * float3(443.897, 441.423, 437.195));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

half4 main(float2 xy) {
  half4 color = image.eval(xy);
  float n = hash(floor(xy));
  float threshold = progress * 1.25 - 0.12;
  float k = smoothstep(threshold - 0.10, threshold + 0.10, n);
  float keep = 1.0 - k;
  float boundary = 1.0 - smoothstep(0.0, 0.22, abs(n - threshold));
  half3 glow = half3(0.85, 0.45, 0.22) * boundary * 0.5;
  return half4(color.rgb * keep + glow * keep, color.a * keep);
}
`)!;

/**
 * Cold-launch brand moment. The mark opens large and dead-center, holds,
 * then resolves to a mid-size "A" that settles just left of screen-center
 * while "lloy" emerges from that same center point to complete the word —
 * the mark IS the "A" (Midtown-Athletic-Club style). "Mentors" drops in
 * underneath while that's still resolving. The whole composed scene then
 * disintegrates into fine dust — a real per-pixel shader dissolve, not
 * discrete particles — clearing to reveal the app. Plays once per cold
 * launch; respects Reduce Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const calledDone = useRef(false);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const lloyFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), LLOY_SIZE);
  const mentorsFont = useFont(require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'), MENTORS_SIZE);

  const cx = W / 2;
  const cy = H / 2;

  const lloyWidth = lloyFont ? lloyFont.getTextWidth('lloy') : LLOY_SIZE * 2.2;
  const mentorsWidth = mentorsFont ? mentorsFont.getTextWidth('MENTORS') : LLOY_SIZE * 2.6;
  const textBlockW = Math.max(lloyWidth, mentorsWidth);

  // Centered-group geometry for the resolved lockup.
  const lockupW = MID + GAP + textBlockW;
  const markCXFinal = cx - lockupW / 2 + MID / 2;
  const textLeftFinal = markCXFinal + MID / 2 + GAP;

  const ready = !!markImage && !!lloyFont && !!mentorsFont;

  const finish = () => {
    if (calledDone.current) return;
    calledDone.current = true;
    onDone();
  };

  // Mark: animate the actual box (center-x + size) directly — no transform-
  // origin ambiguity.
  const markSize = useSharedValue(LARGE);
  const markCX = useSharedValue(cx);

  // "lloy": starts near the mark's own center (reads as emerging from it),
  // fades + slides out to its resting position.
  const lloyOpacity = useSharedValue(0);
  const lloyX = useSharedValue(cx);

  // "Mentors": drop-down reveal.
  const mentorsOpacity = useSharedValue(0);
  const mentorsY = useSharedValue(cy - 14);

  const progress = useSharedValue(0);   // dissolve 0 → 1
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled?.().then((reduced) => {
      if (cancelled) return;

      if (reduced) {
        markSize.value = MID;
        markCX.value = markCXFinal;
        lloyOpacity.value = 1;
        lloyX.value = textLeftFinal;
        mentorsOpacity.value = 1;
        mentorsY.value = cy + LLOY_SIZE * 0.7;
        overlayOpacity.value = withDelay(650, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      markSize.value = withDelay(T.hold, withTiming(MID, { duration: T.resolve, easing: ease }));
      markCX.value = withDelay(T.hold, withTiming(markCXFinal, { duration: T.resolve, easing: ease }));

      const lloyDelay = T.hold + 260;
      lloyOpacity.value = withDelay(lloyDelay, withTiming(1, { duration: T.resolve - 260, easing: ease }));
      lloyX.value = withDelay(lloyDelay, withTiming(textLeftFinal, { duration: T.resolve - 260, easing: ease }));

      const mentorsDelay = T.hold + T.mentorsDelay;
      mentorsOpacity.value = withDelay(mentorsDelay, withTiming(1, { duration: T.mentorsDur, easing: ease }));
      mentorsY.value = withDelay(
        mentorsDelay,
        withTiming(cy + LLOY_SIZE * 0.7, { duration: T.mentorsDur, easing: Easing.out(Easing.back(1.3)) })
      );

      const dissolveDelay = T.hold + T.resolve + T.settle;
      progress.value = withDelay(dissolveDelay, withTiming(1, { duration: T.dissolve, easing: Easing.inOut(Easing.quad) }));
      overlayOpacity.value = withDelay(
        dissolveDelay + T.dissolve + 40,
        withTiming(0, { duration: 60 }, (d) => {
          if (d) runOnJS(finish)();
        })
      );
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const uniforms = useDerivedValue(() => ({ progress: progress.value }));

  const markX = useDerivedValue(() => markCX.value - markSize.value / 2);
  const markY = useDerivedValue(() => cy - markSize.value / 2);
  const markWH = useDerivedValue(() => markSize.value);

  const lloyTextX = useDerivedValue(() => lloyX.value);
  const lloyY = useDerivedValue(() => cy + LLOY_SIZE * 0.36);
  const lloyOp = useDerivedValue(() => lloyOpacity.value);

  const mentorsTextX = useDerivedValue(() => lloyX.value);
  const mentorsOp = useDerivedValue(() => mentorsOpacity.value);

  if (!ready) {
    // Native pine screen while assets load — no flash, matches the native
    // splash background so there is zero visible seam.
    return <Canvas style={StyleSheet.absoluteFillObject}><Rect x={0} y={0} width={W} height={H} color={PINE} /></Canvas>;
  }

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 999, elevation: 999 }]} pointerEvents="none">
      <Group opacity={overlayOpacity}>
        <Group>
          <RuntimeShader source={dissolveSource} uniforms={uniforms} />
          <Rect x={0} y={0} width={W} height={H} color={PINE} />
          <SkiaImage image={markImage} x={markX} y={markY} width={markWH} height={markWH} fit="contain" />
          <SkiaText text="lloy" x={lloyTextX} y={lloyY} font={lloyFont} color={CREAM} opacity={lloyOp} />
          <SkiaText
            text="MENTORS"
            x={mentorsTextX}
            y={mentorsY}
            font={mentorsFont}
            color="rgba(244,246,246,0.72)"
            opacity={mentorsOp}
          />
        </Group>
      </Group>
    </Canvas>
  );
}
