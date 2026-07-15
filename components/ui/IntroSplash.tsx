import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Rect,
  rect,
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
const GLYPH = 140;    // final size of each split half-glyph's square draw box
const WORD_SIZE = 82; // "lloy"/"entors" — sized so the text cap-height ≈ the A's visible height
const TUCK = 12;      // gap from each glyph's real stroke edge to its text

// Measured stroke bounds of splash-icon.png (normalized to its square box):
//   gray "A":   x∈[0.313,0.684], y∈[0.095,0.498]
//   orange "M": x∈[0.16, 0.839], y∈[0.46, 0.904]
// Used to (a) size the glyphs so the A's visible height matches the text,
// (b) place each line's text just right of that line's own stroke, and
// (c) sit each drawn glyph on its text baseline. All independently verified
// earlier in this project.
const CONTENT_L = 0.16;  // leftmost opaque pixel (the M's left)
const A_RIGHT = 0.68;    // A's right leg at the baseline
const M_RIGHT = 0.839;   // M's right leg
const A_TOP = 0.095;
const A_BOTTOM = 0.498;
const M_BOTTOM = 0.904;
const SPLIT_Y = 0.47;    // horizontal seam between the A and M halves (their interlock point)
const A_VIS = A_BOTTOM - A_TOP; // 0.403

const LINE_PITCH = Math.round(GLYPH * 0.62); // baseline-to-baseline distance between the two lines

// Timeline (ms from mount):
const HOLD_BIG = 1800;   // 1. hold on the big, intact, centered mark
const SETTLE_MS = 850;   // 2. shrinks a little AND glides to its lockup anchor — still one piece,
                          //    still vertically centered (folds the horizontal move in here, so the
                          //    split itself is purely vertical — no diagonal drift to the corner)
const SPLIT_MS = 900;    // 3. splits VERTICALLY: A rises to line 1, M drops to line 2, and
                          //    "lloy"/"entors" spawn out to the right, filling each word
const SETTLE_TEXT = 300; // 4. brief hold on the finished two-line wordmark
const FADE_MS = 900;     // 5. uniform fade of the whole overlay to reveal the app

/**
 * Cold-launch brand moment — the mark IS the text. It tears into its two
 * halves and each becomes the leading letter of its line:
 *
 * 1. Big intact mark, dead-center. Holds 1.8s.
 * 2. Shrinks a little and glides horizontally into its lockup anchor (still
 *    one intact piece, still vertically centered). Doing the horizontal move
 *    HERE — not during the split — is deliberate: it keeps the split itself
 *    a clean vertical separation instead of a diagonal drift toward a corner.
 * 3. Splits vertically: the gray "A" half rises to become the leading glyph
 *    of "Alloy", the orange "M" half drops to become the leading glyph of
 *    "Mentors", and "lloy"/"entors" slide/fade out to the right of their
 *    glyph, sized to match the glyphs so each line reads as one word.
 * 4. Brief settle.
 * 5. The whole overlay fades uniformly to reveal the app underneath.
 *
 * Each half is the SAME source image drawn twice, cropped to its half via a
 * Skia `Group clip={rect(...)}` whose rect is a derived value tracking that
 * half's own animated box — so the crop follows the piece as it moves. One
 * persistent Canvas the whole time; no unmount/remount, no snapshotting.
 *
 * Lives above the router Stack so the destination is already loaded by the
 * time the reveal reaches it. Respects Reduce Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const calledDone = useRef(false);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const lloyFont = useFont(require('@expo-google-fonts/poppins/900Black/Poppins_900Black.ttf'), WORD_SIZE);
  const entorsFont = useFont(require('@expo-google-fonts/poppins/900Black/Poppins_900Black.ttf'), WORD_SIZE);

  const cx = W / 2;
  const cy = H / 2;
  const ready = !!markImage && !!lloyFont && !!entorsFont;

  const lloyW = lloyFont ? lloyFont.getTextWidth('lloy') : WORD_SIZE * 1.6;
  const entorsW = entorsFont ? entorsFont.getTextWidth('entors') : WORD_SIZE * 2.5;

  // ---- Final layout geometry ----------------------------------------------
  // Two lines, each = [glyph][tuck][text]. Each line's text begins just right
  // of that line's own glyph stroke (clearance = TUCK, independent of font
  // metrics and of the centering offset). The whole lockup's real visual
  // bounding box is centered on screen horizontally.
  const lloyXRel = A_RIGHT * GLYPH + TUCK;
  const entorsXRel = M_RIGHT * GLYPH + TUCK;

  const groupLeft = CONTENT_L * GLYPH;
  const groupRight = Math.max(M_RIGHT * GLYPH, lloyXRel + lloyW, entorsXRel + entorsW);
  const offsetX = cx - (groupLeft + groupRight) / 2;
  const glyphXFinal = offsetX; // both glyph boxes' final left edge

  // Vertical: center the glyph block (A's cap top → M's bottom) on cy. Both
  // baselines shift down by A_VIS/2·GLYPH from a naive symmetric placement so
  // the tall A ascender doesn't make the block sit high.
  const vShift = (A_VIS / 2) * GLYPH;
  const alloyBaseline = cy - LINE_PITCH / 2 + vShift;
  const mentorsBaseline = cy + LINE_PITCH / 2 + vShift;
  const aYFinal = alloyBaseline - A_BOTTOM * GLYPH;    // A legs land on the "Alloy" baseline
  const mYFinal = mentorsBaseline - M_BOTTOM * GLYPH;  // M feet land on the "Mentors" baseline

  // Intact-mark anchor at the end of beat 2: same box-left as the final
  // glyphs, vertically centered (both halves coincide → looks like one mark).
  const anchorY = cy - GLYPH / 2;

  // ---- Animated state -------------------------------------------------------
  const glyphSize = useSharedValue(MARK_BIG);
  const aX = useSharedValue(cx - MARK_BIG / 2);
  const aY = useSharedValue(cy - MARK_BIG / 2);
  const mX = useSharedValue(cx - MARK_BIG / 2);
  const mY = useSharedValue(cy - MARK_BIG / 2);
  const lloyX = useSharedValue(cx);
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

    // `?? Promise.resolve(false)` guards the whole chain: on any platform where
    // isReduceMotionEnabled is missing, we still run the normal (non-reduced)
    // animation rather than throwing on `.then` and hard-blocking the splash.
    (AccessibilityInfo.isReduceMotionEnabled?.() ?? Promise.resolve(false)).then((reduced) => {
      if (cancelled) return;

      // Text emerges from the glyph, so start it there (invisible until beat 3).
      lloyX.value = glyphXFinal;
      entorsX.value = glyphXFinal;

      if (reduced) {
        glyphSize.value = GLYPH;
        aX.value = glyphXFinal; aY.value = aYFinal;
        mX.value = glyphXFinal; mY.value = mYFinal;
        lloyX.value = lloyXRel + glyphXFinal;
        entorsX.value = entorsXRel + glyphXFinal;
        textOpacity.value = 1;
        overlayOpacity.value = withDelay(700, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      // Beat 2 — shrink + glide to the anchor (both halves coincide the whole
      // time, so it still reads as one intact mark).
      glyphSize.value = withDelay(HOLD_BIG, withTiming(GLYPH, { duration: SETTLE_MS, easing: ease }));
      aX.value = withDelay(HOLD_BIG, withTiming(glyphXFinal, { duration: SETTLE_MS, easing: ease }));
      mX.value = withDelay(HOLD_BIG, withTiming(glyphXFinal, { duration: SETTLE_MS, easing: ease }));
      aY.value = withDelay(HOLD_BIG, withTiming(anchorY, { duration: SETTLE_MS, easing: ease }));
      mY.value = withDelay(HOLD_BIG, withTiming(anchorY, { duration: SETTLE_MS, easing: ease }));

      // Beat 3 — vertical-only split; text fills out to the right.
      const splitDelay = HOLD_BIG + SETTLE_MS;
      aY.value = withDelay(splitDelay, withTiming(aYFinal, { duration: SPLIT_MS, easing: ease }));
      mY.value = withDelay(splitDelay, withTiming(mYFinal, { duration: SPLIT_MS, easing: ease }));
      lloyX.value = withDelay(splitDelay, withTiming(lloyXRel + glyphXFinal, { duration: SPLIT_MS, easing: ease }));
      entorsX.value = withDelay(splitDelay, withTiming(entorsXRel + glyphXFinal, { duration: SPLIT_MS, easing: ease }));
      textOpacity.value = withDelay(splitDelay, withTiming(1, { duration: SPLIT_MS, easing: ease }));

      // Beat 5 — settle, then a single uniform fade.
      const fadeDelay = splitDelay + SPLIT_MS + SETTLE_TEXT;
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
  const gSize = useDerivedValue(() => glyphSize.value);
  const aClip = useDerivedValue(() => rect(aX.value, aY.value, glyphSize.value, glyphSize.value * SPLIT_Y));
  const mClip = useDerivedValue(() =>
    rect(mX.value, mY.value + glyphSize.value * SPLIT_Y, glyphSize.value, glyphSize.value * (1 - SPLIT_Y))
  );
  const aXd = useDerivedValue(() => aX.value);
  const aYd = useDerivedValue(() => aY.value);
  const mXd = useDerivedValue(() => mX.value);
  const mYd = useDerivedValue(() => mY.value);
  const lloyXd = useDerivedValue(() => lloyX.value);
  const entorsXd = useDerivedValue(() => entorsX.value);
  const textOp = useDerivedValue(() => textOpacity.value);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={W} height={H} color={PINE} />
        {ready && (
          <>
            {/* Gray "A" — top crop of the mark, tracks its own moving box. */}
            <Group clip={aClip}>
              <SkiaImage image={markImage} x={aXd} y={aYd} width={gSize} height={gSize} fit="contain" />
            </Group>
            {/* Orange "M" — bottom crop of the mark, tracks its own moving box. */}
            <Group clip={mClip}>
              <SkiaImage image={markImage} x={mXd} y={mYd} width={gSize} height={gSize} fit="contain" />
            </Group>
            <Group opacity={textOp}>
              <SkiaText text="lloy" x={lloyXd} y={alloyBaseline} font={lloyFont} color={SILVER} />
              <SkiaText text="entors" x={entorsXd} y={mentorsBaseline} font={entorsFont} color={CLAY} />
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
