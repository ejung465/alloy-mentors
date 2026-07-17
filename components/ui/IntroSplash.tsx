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

const MARK_BIG = 232; // the big, intact mark the app opens on

const WORD_SIZE = 56;                          // both text lines, same size
const LINE_PITCH = Math.round(WORD_SIZE * 1.1); // baseline-to-baseline distance
const CAP_RATIO = 0.75;                         // Poppins Black cap-height as a fraction of font size
const ICON_GAP = 14;                            // gap between the mark's content edge and the wordmark

// Measured directly from splash-icon.png (normalized to its square box):
// opaque content spans x∈[0.16,0.839], y∈[0.095,0.904] — the square asset
// has padding baked in on all sides, so the mark's DRAWN box is bigger than
// its visible content.
const MARK_CONTENT_L = 0.16;
const MARK_CONTENT_R = 0.839;
const MARK_TOP = 0.095;
const MARK_BOTTOM = 0.904;
const MARK_CONTENT_H = MARK_BOTTOM - MARK_TOP; // 0.809

// The settled mark size is DERIVED, not guessed: solve for the box size
// where the mark's visible content height exactly equals the two-line text
// block's own visible height (top of "Alloy"'s caps to bottom of
// "Mentors") — so the two align top AND bottom, not just center.
const TEXT_BLOCK_H = LINE_PITCH + CAP_RATIO * WORD_SIZE;
const MARK_FINAL = TEXT_BLOCK_H / MARK_CONTENT_H;

// Timeline (ms from mount) — four sequential beats, not overlapping:
const HOLD_BIG = 1800;   // 1. hold on the big, centered mark
const SHRINK_MS = 700;   // 2. shrinks in place (still centered) — no horizontal motion yet
const MOVE_MS = 1000;    // 3. THEN slides left while the wordmark slides out from the mark
const SETTLE_TEXT = 250; // 4. brief hold on the finished, centered lockup
const FADE_MS = 900;     // uniform fade of the whole overlay to reveal the app

/**
 * Cold-launch brand moment — back to the intact icon+wordmark lockup (not
 * the split-glyph experiment): the mark stays ONE piece throughout.
 *
 * 1. Opens on the big mark, dead-center. Holds 1.8s.
 * 2. Shrinks in place (still centered) — no lateral motion during the
 *    shrink itself.
 * 3. Only once shrunk does it slide left; a two-line wordmark — "Alloy"
 *    (gray) over "Mentors" (orange), full words, same size — slides out
 *    from the mark's position at the same time.
 * 4. Brief settle, then the ENTIRE overlay fades uniformly to reveal the app.
 *
 * Vertical alignment is DERIVED, not eyeballed: MARK_FINAL is solved so the
 * mark's own visible content (it has padding baked into its square asset —
 * see MARK_TOP/MARK_BOTTOM) spans exactly the same height as the two-line
 * text block, and both are positioned so their tops and bottoms coincide —
 * not just their centers.
 *
 * Single persistent Canvas the whole time — no unmount/remount, no
 * snapshotting. Lives above the router Stack so the destination is already
 * loaded by the time the fade reaches it. Respects Reduce Motion.
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

  // ---- Vertical: text block's true visual span (cap-top of "Alloy" to
  // bottom of "Mentors") centered on cy, then the mark's box positioned so
  // ITS visible content (not its padded box) starts/ends at the same points.
  const textBlockTop = cy - TEXT_BLOCK_H / 2;
  const alloyBaseline = textBlockTop + CAP_RATIO * WORD_SIZE;
  const mentorsBaseline = alloyBaseline + LINE_PITCH;
  const markYFinal = textBlockTop - MARK_TOP * MARK_FINAL; // mark's visible top == textBlockTop

  // ---- Horizontal: standard icon+wordmark lockup — mark on the left, a
  // fixed gap, then the two-line wordmark (both lines share the same left
  // edge). The group's real visual bounding box (mark's opaque content-left
  // → widest text-right) is centered on screen.
  const markLeftRel = 0;
  const textXRel = MARK_CONTENT_R * MARK_FINAL + ICON_GAP;

  const groupLeft = MARK_CONTENT_L * MARK_FINAL;
  const groupRight = Math.max(MARK_CONTENT_R * MARK_FINAL, textXRel + alloyW, textXRel + mentorsW);
  const groupCenterRel = (groupLeft + groupRight) / 2;
  const offsetX = cx - groupCenterRel;

  const markCXFinal = markLeftRel + MARK_FINAL / 2 + offsetX;
  const textXFinal = textXRel + offsetX;

  // markCYFinal: the vertical center that makes the mark's box land exactly
  // on markYFinal once it's back at MARK_FINAL size (mY = markCY - size/2).
  const markCYFinal = markYFinal + MARK_FINAL / 2;

  // ---- Animated state -----------------------------------------------------
  const markSize = useSharedValue(MARK_BIG);
  const markCX = useSharedValue(cx);
  const markCY = useSharedValue(cy); // vertical anchor — stays at cy through the shrink, THEN
                                      // animates to markCYFinal in sync with the horizontal slide
                                      // (mirrors markCX), so there's no jump when the shrink ends.
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

    (AccessibilityInfo.isReduceMotionEnabled?.() ?? Promise.resolve(false)).then((reduced) => {
      if (cancelled) return;

      if (reduced) {
        markSize.value = MARK_FINAL;
        markCX.value = markCXFinal;
        markCY.value = markCYFinal;
        textX.value = textXFinal;
        textOpacity.value = 1;
        overlayOpacity.value = withDelay(700, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      // Beat 2 — shrink in place (markCX/markCY untouched, stay at cx/cy).
      markSize.value = withDelay(HOLD_BIG, withTiming(MARK_FINAL, { duration: SHRINK_MS, easing: ease }));

      // Beat 3 — only after the shrink completes: slide left AND to its
      // vertical-alignment position while the wordmark slides out, all in
      // sync (same delay/duration/easing) — smooth combined move, no jump.
      const moveDelay = HOLD_BIG + SHRINK_MS;
      markCX.value = withDelay(moveDelay, withTiming(markCXFinal, { duration: MOVE_MS, easing: ease }));
      markCY.value = withDelay(moveDelay, withTiming(markCYFinal, { duration: MOVE_MS, easing: ease }));
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

  // Skia-driven props. mX/mY derive from the SAME markCX/markCY anchors that
  // animate smoothly (see above) — during the shrink (beat 2) markCX/markCY
  // are untouched at cx/cy, so the mark shrinks centered in place; during
  // the slide (beat 3) both anchors animate together to their final values,
  // so the mark's box smoothly reaches (markCXFinal, markYFinal) with no
  // discontinuity anywhere in the sequence.
  const mSize = useDerivedValue(() => markSize.value);
  const mX = useDerivedValue(() => markCX.value - markSize.value / 2);
  const mY = useDerivedValue(() => markCY.value - markSize.value / 2);
  const textXd = useDerivedValue(() => textX.value);
  const textOp = useDerivedValue(() => textOpacity.value);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

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
