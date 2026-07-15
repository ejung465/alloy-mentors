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

const MARK_BIG = 232;  // the big, intact mark the app opens on
const GLYPH = 92;       // final size of EACH cropped half-glyph's square draw
const WORD_SIZE = 78;   // "lloy" / "entors" — sized to match the glyphs' own weight/height
const LINE_PITCH = Math.round(GLYPH * 1.05); // baseline-to-baseline distance between the two lines
const TUCK = Math.round(GLYPH * 0.09);       // gap from each glyph's real stroke edge to its text

// The mark art doesn't fill its square box — measured directly from
// splash-icon.png: opaque content sits at x∈[0.16,0.839] of the box; the
// gray "A" strokes reach ~0.62 of the box width at the line where text
// starts; the orange "M"'s right leg reaches ~0.839. (Same measurements
// already verified twice earlier in this project for the icon+wordmark
// lockup — reused here since it's the same source image.)
const A_RIGHT = 0.62;
const M_RIGHT = 0.839;

// Timeline (ms from mount) — EXPERIMENTAL redesign, five sequential beats:
const HOLD_BIG = 1800;   // 1. hold on the big, intact, centered mark
const SHRINK_MS = 700;   // 2. shrinks in place to glyph scale — still one piece, still centered
const SPLIT_MS = 1000;   // 3. splits into its gray-A half and orange-M half, each sliding to its
                          //    own line's start position, while "lloy"/"entors" slide out beside them
const SETTLE_TEXT = 250; // 4. brief hold on the finished two-line wordmark
const FADE_MS = 900;     // 5. uniform fade of the whole overlay to reveal the app

/**
 * Cold-launch brand moment — EXPERIMENTAL: the mark is no longer a separate
 * icon sitting beside the wordmark. It tears into its two halves and each
 * becomes the literal first letter of its line:
 *
 * 1. Opens on the big, intact mark (both halves overlapping as one piece),
 *    dead-center. Holds 1.8s.
 * 2. Shrinks in place to glyph scale — still one intact piece.
 * 3. Splits: the gray upper half (the "A") slides to become the leading
 *    glyph of the top line, where "lloy" fades in beside it to complete
 *    "Alloy." The orange lower half (the "M") simultaneously slides to
 *    become the leading glyph of the bottom line, where "entors" fades in
 *    beside it to complete "Mentors." Both text lines are sized to match
 *    the glyphs' own weight/height, so the drawn and typed letters read as
 *    one continuous wordmark, not an icon next to a caption.
 * 4. Brief settle.
 * 5. The ENTIRE overlay fades uniformly to reveal the app underneath.
 *
 * Implementation: each half-glyph is the SAME source image drawn twice, each
 * instance cropped to only its half via a Skia `Group clip={rect(...)}`
 * whose rect is a derived value tracking that instance's own animated
 * position/size — so the crop always follows the piece as it moves. Single
 * persistent Canvas for the whole sequence — no unmount/remount, no
 * snapshotting.
 *
 * Lives above the router Stack (see app/_layout.tsx) so the destination is
 * real and already loaded by the time the reveal reaches it. Respects Reduce
 * Motion.
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
  const entorsW = entorsFont ? entorsFont.getTextWidth('entors') : WORD_SIZE * 2.4;

  // ---- Final layout geometry (both axes) -----------------------------------
  // Two lines, each [glyph][tuck][text], both lines' glyphs sharing the same
  // left edge (x=0 in this line-relative system). Text begins just right of
  // that line's own glyph stroke, independent of font metrics or the
  // group's centering offset (same "clearance cancels out" construction
  // verified for the earlier icon+wordmark lockup).
  const lloyXRel = GLYPH * A_RIGHT + TUCK;
  const entorsXRel = GLYPH * M_RIGHT + TUCK;

  const groupLeft = GLYPH * 0.16; // the mark's real opaque content starts here, not x=0
  const groupRight = Math.max(GLYPH * M_RIGHT, lloyXRel + lloyW, entorsXRel + entorsW);
  const groupCenterRel = (groupLeft + groupRight) / 2;
  const offsetX = cx - groupCenterRel;

  const glyphXFinal = offsetX; // both glyphs' final left edge (line-relative x=0 + offset)
  const lloyXFinal = lloyXRel + offsetX;
  const entorsXFinal = entorsXRel + offsetX;

  const line1CenterY = cy - LINE_PITCH / 2; // "Alloy" row
  const line2CenterY = cy + LINE_PITCH / 2; // "Mentors" row
  // Each glyph is a half-crop of a GLYPH×GLYPH square: the visible slice is
  // GLYPH tall × (GLYPH/2) tall. Solve each piece's final top-left Y so that
  // slice's own vertical center lands on its line's center.
  const aYFinal = line1CenterY - GLYPH * 0.25;         // top-half crop: slice center = y + GLYPH/4
  const mYFinal = line2CenterY - GLYPH * 0.75;         // bottom-half crop: slice center = y + GLYPH*3/4
  const lloyBaseline = line1CenterY + WORD_SIZE * 0.3;
  const entorsBaseline = line2CenterY + WORD_SIZE * 0.3;

  // ---- Animated state -------------------------------------------------------
  const glyphSize = useSharedValue(MARK_BIG); // shared by both halves through the shrink
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

    AccessibilityInfo.isReduceMotionEnabled?.().then((reduced) => {
      if (cancelled) return;

      if (reduced) {
        glyphSize.value = GLYPH;
        aX.value = glyphXFinal; aY.value = aYFinal;
        mX.value = glyphXFinal; mY.value = mYFinal;
        lloyX.value = lloyXFinal; entorsX.value = entorsXFinal;
        textOpacity.value = 1;
        overlayOpacity.value = withDelay(700, withTiming(0, { duration: 400 }, (d) => {
          if (d) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);

      // Beat 2 — shrink in place, both halves still coincide (one intact piece).
      const shrinkTo = (sv: typeof aX, target: number) =>
        { sv.value = withDelay(HOLD_BIG, withTiming(target, { duration: SHRINK_MS, easing: ease })); };
      glyphSize.value = withDelay(HOLD_BIG, withTiming(GLYPH, { duration: SHRINK_MS, easing: ease }));
      shrinkTo(aX, cx - GLYPH / 2); shrinkTo(aY, cy - GLYPH / 2);
      shrinkTo(mX, cx - GLYPH / 2); shrinkTo(mY, cy - GLYPH / 2);

      // Beat 3 — split: A-half → top line, M-half → bottom line, text slides
      // out from the shared pre-split position at the same time.
      const splitDelay = HOLD_BIG + SHRINK_MS;
      aX.value = withDelay(splitDelay, withTiming(glyphXFinal, { duration: SPLIT_MS, easing: ease }));
      aY.value = withDelay(splitDelay, withTiming(aYFinal, { duration: SPLIT_MS, easing: ease }));
      mX.value = withDelay(splitDelay, withTiming(glyphXFinal, { duration: SPLIT_MS, easing: ease }));
      mY.value = withDelay(splitDelay, withTiming(mYFinal, { duration: SPLIT_MS, easing: ease }));
      lloyX.value = withDelay(splitDelay, withTiming(lloyXFinal, { duration: SPLIT_MS, easing: ease }));
      entorsX.value = withDelay(splitDelay, withTiming(entorsXFinal, { duration: SPLIT_MS, easing: ease }));
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
  const aClip = useDerivedValue(() => rect(aX.value, aY.value, glyphSize.value, glyphSize.value / 2));
  const mClip = useDerivedValue(() => rect(mX.value, mY.value + glyphSize.value / 2, glyphSize.value, glyphSize.value / 2));
  const aXd = useDerivedValue(() => aX.value);
  const aYd = useDerivedValue(() => aY.value);
  const mXd = useDerivedValue(() => mX.value);
  const mYd = useDerivedValue(() => mY.value);
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
            {/* Gray "A" half — top-half crop of the mark, tracks its own position. */}
            <Group clip={aClip}>
              <SkiaImage image={markImage} x={aXd} y={aYd} width={gSize} height={gSize} fit="contain" />
            </Group>
            {/* Orange "M" half — bottom-half crop of the mark, tracks its own position. */}
            <Group clip={mClip}>
              <SkiaImage image={markImage} x={mXd} y={mYd} width={gSize} height={gSize} fit="contain" />
            </Group>
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
