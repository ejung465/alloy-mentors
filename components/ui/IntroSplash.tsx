import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Rect,
  Text as SkiaText,
  useFont,
  useImage,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const PINE = '#165B74';
const SILVER = '#C4C4C4'; // matches the mark's gray "A"
const CLAY = '#C5642D';   // matches the mark's orange "M"

const MARK_BIG = 232; // the big "A" the app opens on

// Wordmark sized to match the big mark's own letterforms (cap-height of the A
// on the opening screen), since there's no icon left on screen to key off of.
const WORD_SIZE = Math.round(MARK_BIG * 0.4);
const LINE_GAP = Math.round(WORD_SIZE * 0.18);

// Timeline (ms from mount) — three beats:
const HOLD_BIG = 1800;    // 1. hold on the big, centered "A" (+0.3s per user testing)
const CROSSFADE_MS = 800; // 2. the mark dissolves as "Alloy" / "Mentors" fades in, in place — no icon lockup
const SETTLE_TEXT = 550;  // 3. brief hold on the finished wordmark before the reveal
const FADE_MS = 900;      // uniform fade of the whole overlay to reveal the app — no sweep, no stagger

/**
 * Cold-launch brand moment — three beats:
 *
 * 1. Opens on the big "A" mark, dead-center. Holds 1.8s.
 * 2. The mark crossfades directly into plain two-line wordmark text —
 *    "Alloy" (gray) over "Mentors" (orange), both spelled out in full,
 *    left-aligned to each other, sized to match the mark's own letterforms.
 *    No icon remains on screen — user testing found the icon+wordmark/letter-
 *    continuation reads as confusing; plain text alone is clearer.
 * 3. Brief settle, then the ENTIRE overlay (background + text as one unit —
 *    a single live Skia canvas, not a captured picture) fades uniformly to
 *    reveal the app underneath. No spatial sweep/stagger.
 *
 * Rendering a single persistent Canvas for the whole sequence (rather than
 * swapping to a captured-snapshot tile grid at the end) avoids any
 * unmount/remount transition and nothing to decode asynchronously — the same
 * canvas that has been painting the settled wordmark simply becomes
 * transparent.
 *
 * Lives above the router Stack (see app/_layout.tsx) so the destination is
 * real and already loaded by the time the fade reaches it. Respects Reduce
 * Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const calledDone = useRef(false);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const alloyFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), WORD_SIZE);
  const mentorsFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), WORD_SIZE);

  const cx = W / 2;
  const cy = H / 2;
  const ready = !!markImage && !!alloyFont && !!mentorsFont;

  const alloyW = alloyFont ? alloyFont.getTextWidth('Alloy') : WORD_SIZE * 2.1;
  const mentorsW = mentorsFont ? mentorsFont.getTextWidth('Mentors') : WORD_SIZE * 3.1;

  // Two lines, left-aligned to EACH OTHER (not to center), the pair centered
  // as one block on screen — matches the mockup exactly.
  const blockW = Math.max(alloyW, mentorsW);
  const textLeft = cx - blockW / 2;

  // Standard Inter Black ascent ratio (~0.78 of the em) to vertically center
  // the two-line block around cy using baseline coordinates.
  const totalH = WORD_SIZE * 2 + LINE_GAP;
  const blockTop = cy - totalH / 2;
  const alloyBaseline = blockTop + WORD_SIZE * 0.78;
  const mentorsBaseline = alloyBaseline + WORD_SIZE + LINE_GAP;

  // ---- Animated state -----------------------------------------------------
  const markOpacity = useSharedValue(1);
  const textOpacity = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);

  const finish = () => {
    if (calledDone.current) return;
    calledDone.current = true;
    onDone();
  };

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled?.().then((reduced) => {
      if (cancelled) return;

      if (reduced) {
        markOpacity.value = 0;
        textOpacity.value = 1;
        overlayOpacity.value = withDelay(700, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      // Beat 2 — crossfade: mark dissolves, wordmark fades in, in place.
      markOpacity.value = withDelay(HOLD_BIG, withTiming(0, { duration: CROSSFADE_MS, easing: ease }));
      textOpacity.value = withDelay(HOLD_BIG, withTiming(1, { duration: CROSSFADE_MS, easing: ease }));

      // Beat 3 — settle, then a single uniform fade (no sweep/stagger).
      const fadeDelay = HOLD_BIG + CROSSFADE_MS + SETTLE_TEXT;
      overlayOpacity.value = withDelay(
        fadeDelay,
        withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.cubic) }, (d) => {
          if (d) runOnJS(finish)();
        })
      );
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Skia-driven props.
  const mOp = useDerivedValue(() => markOpacity.value);
  const tOp = useDerivedValue(() => textOpacity.value);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  // Always the same shell — Animated.View wrapping one Canvas — for the
  // entire lifetime of the component, including before assets finish
  // loading. Only the Canvas's CHILDREN differ (just the pine background
  // until ready), so there is genuinely no unmount/remount at any point in
  // the sequence, not even at the loading→ready handoff.
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={W} height={H} color={PINE} />
        {ready && (
          <>
            <Group opacity={mOp}>
              <SkiaImage
                image={markImage}
                x={cx - MARK_BIG / 2}
                y={cy - MARK_BIG / 2}
                width={MARK_BIG}
                height={MARK_BIG}
                fit="contain"
              />
            </Group>
            <Group opacity={tOp}>
              <SkiaText text="Alloy" x={textLeft} y={alloyBaseline} font={alloyFont} color={SILVER} />
              <SkiaText text="Mentors" x={textLeft} y={mentorsBaseline} font={mentorsFont} color={CLAY} />
            </Group>
          </>
        )}
      </Canvas>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 999, elevation: 999 },
});
