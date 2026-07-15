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

const MARK_BIG = 232;   // the big "A" the app opens on
const MARK_FINAL = 150; // settled size, icon+wordmark lockup

const WORD_SIZE = Math.round(MARK_FINAL * 0.34); // BOTH lines the same size now
const LINE_PITCH = Math.round(WORD_SIZE * 1.08);  // baseline-to-baseline distance
const ICON_GAP = 14; // gap between the mark's content edge and the wordmark block

// Timeline (ms from mount) — four sequential beats, not overlapping:
const HOLD_BIG = 1800;   // 1. hold on the big, centered "A" (+0.3s per user testing)
const SHRINK_MS = 700;   // 2. shrinks in place (still centered) — no horizontal motion yet
const MOVE_MS = 1000;    // 3. THEN slides left while the wordmark slides out from the mark
const SETTLE_TEXT = 250; // 4. brief hold on the finished, centered lockup
const FADE_MS = 900;     // uniform fade of the whole overlay to reveal the app

/**
 * Cold-launch brand moment — five sequential beats:
 *
 * 1. Opens on the big "A" mark, dead-center. Holds 1.8s.
 * 2. The mark shrinks in place (still centered) — no lateral motion during
 *    the shrink itself.
 * 3. Only once shrunk does it slide left; a two-line wordmark — "Alloy"
 *    (gray) over "Mentors" (orange), both spelled out in FULL, same size,
 *    left-aligned together — slides out from the mark's position at the
 *    same time. The mark + wordmark block are laid out as ONE bounding-box
 *    group (both horizontally AND vertically) and that whole group is what's
 *    centered on screen — computed from actual measured text metrics, so it
 *    holds regardless of exact font metrics.
 * 4. Brief settle, then the ENTIRE overlay (background + mark + text as one
 *    unit — a single live Skia canvas, not a captured picture) fades
 *    uniformly to reveal the app underneath.
 *
 * Rendering a single persistent Canvas for the whole sequence (rather than
 * swapping to a captured-snapshot tile grid at the end) removes an earlier
 * flicker at its root: there is no unmount/remount transition and nothing to
 * decode asynchronously.
 *
 * Lives above the router Stack (see app/_layout.tsx) so the destination is
 * real and already loaded by the time the reveal reaches it. Respects Reduce
 * Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const calledDone = useRef(false);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const alloyFont = useFont(require('@expo-google-fonts/poppins/900Black/Poppins_900Black.ttf'), WORD_SIZE);
  const mentorsFont = useFont(require('@expo-google-fonts/poppins/900Black/Poppins_900Black.ttf'), WORD_SIZE);

  const cx = W / 2;
  const cy = H / 2;
  const ready = !!markImage && !!alloyFont && !!mentorsFont;

  const alloyW = alloyFont ? alloyFont.getTextWidth('Alloy') : WORD_SIZE * 2.2;
  const mentorsW = mentorsFont ? mentorsFont.getTextWidth('Mentors') : WORD_SIZE * 3.3;

  // ---- Group-centered geometry (both axes) --------------------------------
  // Standard icon+wordmark lockup: mark on the left, a fixed gap, then the
  // two-line wordmark block (both lines share the same left edge, same size).
  //
  // Horizontal: the group's real bounding box (mark's opaque content-left,
  // per splash-icon.png, → widest text-right) is centered on screen.
  //
  // Vertical: previously the two baselines used fixed, unequal offsets
  // (leftover from a different layout), which — combined with "Alloy"'s
  // descender ("y") extending below its baseline while "Mentors" has none —
  // made the visible block sit noticeably above true center. Now the two
  // baselines are placed symmetrically (±LINE_PITCH/2) around the SAME
  // vertical center the mark itself uses, so the pair is genuinely centered
  // as one group, not just individually offset.
  const MARK_CONTENT_L = MARK_FINAL * 0.16; // splash-icon.png's opaque content starts at 16% of its box
  const MARK_CONTENT_R = MARK_FINAL * 0.839;

  const markLeftRel = 0;
  const textXRel = MARK_CONTENT_R + ICON_GAP; // both lines start here

  const groupLeft = MARK_CONTENT_L;
  const groupRight = Math.max(MARK_CONTENT_R, textXRel + alloyW, textXRel + mentorsW);
  const groupCenterRel = (groupLeft + groupRight) / 2;
  const offsetX = cx - groupCenterRel;

  const markCXFinal = markLeftRel + MARK_FINAL / 2 + offsetX;
  const textXFinal = textXRel + offsetX;
  const alloyBaseline = cy - LINE_PITCH / 2;
  const mentorsBaseline = cy + LINE_PITCH / 2;

  // ---- Animated state -----------------------------------------------------
  const markSize = useSharedValue(MARK_BIG);
  const markCX = useSharedValue(cx);
  const textX = useSharedValue(cx); // both lines slide out together from the mark's (pre-move) position
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
        textX.value = textXFinal;
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
      textX.value = withDelay(moveDelay, withTiming(textXFinal, { duration: MOVE_MS, easing: ease }));
      textOpacity.value = withDelay(moveDelay, withTiming(1, { duration: MOVE_MS, easing: ease }));

      // Beat 4 — settle, then a single uniform fade.
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
  const textXd = useDerivedValue(() => textX.value);
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
              <SkiaText text="Alloy" x={textXd} y={alloyBaseline} font={alloyFont} color={SILVER} />
              <SkiaText text="Mentors" x={textXd} y={mentorsBaseline} font={mentorsFont} color={CLAY} />
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
