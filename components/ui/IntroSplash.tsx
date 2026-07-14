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
const SILVER = '#C4C4C4'; // gray of the logo's upper "A" → "lloy"
const CLAY = '#C5642D';   // orange of the logo's lower "M" → "entors"

const MARK_BIG = 232;   // the big "A" the app opens on
const MARK_FINAL = 150; // settled size

const LLOY_SIZE = Math.round(MARK_FINAL * 0.3);
const ENTORS_SIZE = Math.round(MARK_FINAL * 0.36);

// Timeline (ms from mount) — four sequential beats, not overlapping:
const HOLD_BIG = 1500;  // 1. hold on the big, centered "A"
const SHRINK_MS = 700;  // 2. shrinks in place (still centered) — no horizontal motion yet
const MOVE_MS = 1000;   // 3. THEN slides left while the wordmark slides out from the mark
const SETTLE_TEXT = 250; // 4. brief hold on the finished, centered lockup (cut ~0.75s from the previous pass)
const FADE_MS = 900;    // uniform fade of the whole overlay to reveal the app — no sweep, no stagger

/**
 * Cold-launch brand moment — four sequential beats:
 *
 * 1. Opens on the big "A" mark, dead-center. Holds 1.5s.
 * 2. The mark shrinks in place (still centered) — no lateral motion during
 *    the shrink itself.
 * 3. Only once shrunk does it slide left; the wordmark slides out from the
 *    mark's position at the same time — "lloy" (gray, continuing the upper
 *    A) and "entors" (orange, continuing the lower M). The mark + both text
 *    lines are laid out as ONE bounding-box group and that whole group is
 *    what's centered on screen (not just the mark) — the group's combined
 *    left/right extent is computed from the actual measured text widths, so
 *    it's centered regardless of exact font metrics.
 * 4. Brief settle, then the ENTIRE overlay (background + mark + text as one
 *    unit — a single live Skia canvas, not a captured picture) fades
 *    uniformly to reveal the app underneath. No spatial sweep/stagger.
 *
 * Rendering a single persistent Canvas for the whole sequence (rather than
 * swapping to a captured-snapshot tile grid at the end) removes the earlier
 * flicker at its root: there is no unmount/remount transition and nothing to
 * decode asynchronously — the same canvas that has been painting the settled
 * lockup simply becomes transparent.
 *
 * Lives above the router Stack (see app/_layout.tsx) so the destination is
 * real and already loaded by the time the fade reaches it. Respects Reduce
 * Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const calledDone = useRef(false);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const lloyFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), LLOY_SIZE);
  const entorsFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), ENTORS_SIZE);

  const cx = W / 2;
  const cy = H / 2;
  const ready = !!markImage && !!lloyFont && !!entorsFont;

  const lloyW = lloyFont ? lloyFont.getTextWidth('lloy') : MARK_FINAL * 0.7;
  const entorsW = entorsFont ? entorsFont.getTextWidth('entors') : MARK_FINAL * 1.3;

  // ---- Group-centered geometry -------------------------------------------
  // Everything below is computed relative to an arbitrary reference origin
  // (the mark's un-shifted left edge = 0), then the WHOLE group (mark +
  // both text lines) is shifted by one offset so its true combined bounding
  // box lands centered on screen — not just the mark by itself.
  const markLeftRel = 0;
  const markRightRel = MARK_FINAL;
  const lloyXRel = MARK_FINAL * 0.42;   // starts near the mark's center-right, off the A's peak
  const entorsXRel = -MARK_FINAL * 0.05; // starts just left of the mark's edge, off the M's base

  const groupLeft = Math.min(markLeftRel, entorsXRel);
  const groupRight = Math.max(markRightRel, lloyXRel + lloyW, entorsXRel + entorsW);
  const groupCenterRel = (groupLeft + groupRight) / 2;
  const offsetX = cx - groupCenterRel;

  const markCXFinal = markLeftRel + MARK_FINAL / 2 + offsetX;
  const lloyXFinal = lloyXRel + offsetX;
  const entorsXFinal = entorsXRel + offsetX;
  const lloyBaseline = cy - MARK_FINAL * 0.22;   // upper (gray A) line
  const entorsBaseline = cy + MARK_FINAL * 0.62; // lower (orange M) line

  // ---- Animated state -----------------------------------------------------
  const markSize = useSharedValue(MARK_BIG);
  const markCX = useSharedValue(cx);
  const lloyX = useSharedValue(cx);   // text starts AT the mark's (pre-move) position — "slides out from the logo"
  const entorsX = useSharedValue(cx);
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
        markSize.value = MARK_FINAL;
        markCX.value = markCXFinal;
        lloyX.value = lloyXFinal;
        entorsX.value = entorsXFinal;
        textOpacity.value = 1;
        overlayOpacity.value = withDelay(700, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      // Beat 2 — shrink in place (markCX untouched, stays at cx).
      markSize.value = withDelay(HOLD_BIG, withTiming(MARK_FINAL, { duration: SHRINK_MS, easing: ease }));

      // Beat 3 — only after the shrink completes: slide left while the
      // wordmark slides out from the mark's position, in sync.
      const moveDelay = HOLD_BIG + SHRINK_MS;
      markCX.value = withDelay(moveDelay, withTiming(markCXFinal, { duration: MOVE_MS, easing: ease }));
      lloyX.value = withDelay(moveDelay, withTiming(lloyXFinal, { duration: MOVE_MS, easing: ease }));
      entorsX.value = withDelay(moveDelay, withTiming(entorsXFinal, { duration: MOVE_MS, easing: ease }));
      textOpacity.value = withDelay(moveDelay, withTiming(1, { duration: MOVE_MS, easing: ease }));

      // Beat 4 — settle, then a single uniform fade (no sweep/stagger).
      const fadeDelay = moveDelay + MOVE_MS + SETTLE_TEXT;
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
  const mSize = useDerivedValue(() => markSize.value);
  const mX = useDerivedValue(() => markCX.value - markSize.value / 2);
  const mY = useDerivedValue(() => cy - markSize.value / 2);
  const lloyXd = useDerivedValue(() => lloyX.value);
  const entorsXd = useDerivedValue(() => entorsX.value);
  const textOp = useDerivedValue(() => textOpacity.value);

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
            <SkiaImage image={markImage} x={mX} y={mY} width={mSize} height={mSize} fit="contain" />
            <Group opacity={textOp}>
              <SkiaText text="lloy" x={lloyXd} y={lloyBaseline} font={lloyFont} color={SILVER} />
              <SkiaText text="entors" x={entorsXd} y={entorsBaseline} font={entorsFont} color={CLAY} />
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
