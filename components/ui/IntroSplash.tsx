import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Rect,
  Text as SkiaText,
  useCanvasRef,
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
  type SharedValue,
} from 'react-native-reanimated';

const PINE = '#165B74';
const SILVER = '#C4C4C4'; // gray of the logo's upper "A" → "lloy"
const CLAY = '#C5642D';   // orange of the logo's lower "M" → "entors"

const MARK_BIG = 232;   // the big "A" the app opens on
const MARK_FINAL = 150; // slightly smaller, settled size

// Wordmark sizing, derived from the mark height so it always reads as one lockup.
const LLOY_SIZE = Math.round(MARK_FINAL * 0.3);
const ENTORS_SIZE = Math.round(MARK_FINAL * 0.36);

// Timeline (ms from mount).
const HOLD_BIG = 1500;   // hold on just the big "A" before it moves
const RESOLVE = 1700;    // shrink + slide, wordmark emerges — deliberately unhurried
const SETTLE = 300;      // brief hold on the finished lockup before the reveal starts
const FLIP_START_MS = HOLD_BIG + RESOLVE + SETTLE; // ~3.5s total, down from 4.5s
const FLIP_MS = 1300;    // reveal duration
const DECODE_GUARD_MS = 180; // lets the (identical, cached) tile snapshot decode before the wipe starts — see startFlip()

// Reveal grid — ~136 tiles (COLS*ROWS). Kept even though the mechanic below
// is now an opacity wipe, not a flip, so the sweep still reads as a grid.
const COLS = 8;
const ROWS = 17;
const SPREAD = 0.5; // how much the column stagger overlaps

type Tile = { key: string; left: number; top: number; tw: number; th: number; sf: number };

/**
 * Cold-launch brand moment.
 *
 * 1. Opens on the big "A" mark, dead-center. Holds 1.5s.
 * 2. It shrinks slightly and slides left into a centered lockup while the
 *    wordmark resolves out of the mark — "lloy" (gray, continuing the upper
 *    A) and "entors" (orange, continuing the lower M) — so the mark reads as
 *    both letters at once, same idea as the reference mark.
 * 3. Brief settle, then the whole screen sweeps away left → right: a grid of
 *    tiles carrying a snapshot of the settled logo screen fade out on an
 *    accelerating curve (slow at first, then rapidly transparent), uncovering
 *    the already-loaded app underneath.
 *
 * The overlay lives above the router Stack (see app/_layout.tsx), so the
 * destination is real and ready by the time the wipe reaches it. Every tile
 * always has an opaque pine base under its snapshot layer — regardless of
 * exactly when the (identical, cached) snapshot image finishes decoding on
 * the native side — so there is no frame where the app underneath can show
 * through before the wipe actually reaches that tile. Respects Reduce Motion.
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const canvasRef = useCanvasRef();
  const calledDone = useRef(false);
  const [phase, setPhase] = useState<'logo' | 'flip'>('logo');
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const markImage = useImage(require('@/assets/images/splash-icon.png'));
  const lloyFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), LLOY_SIZE);
  const entorsFont = useFont(require('@expo-google-fonts/inter/900Black/Inter_900Black.ttf'), ENTORS_SIZE);

  const cx = W / 2;
  const cy = H / 2;
  const ready = !!markImage && !!lloyFont && !!entorsFont;

  const entorsW = entorsFont ? entorsFont.getTextWidth('entors') : MARK_FINAL * 1.3;

  // Final lockup geometry. The mark's gray "A" occupies its upper-center
  // portion (peaked, narrower) and the orange "M" spans its full width lower
  // down — so "lloy" continues from the A's right leg (center-right of the
  // mark) while "entors" continues from the M's left leg (left edge of the
  // mark), sitting well below "lloy" with generous line gap.
  const markCXFinal = cx - (MARK_FINAL * 0.5 + entorsW * 0.35) / 2; // mark nudged left of the combined lockup's center
  const markLeftFinal = markCXFinal - MARK_FINAL / 2;
  const lloyXFinal = markCXFinal + MARK_FINAL * 0.1;
  const entorsXFinal = markLeftFinal + MARK_FINAL * 0.06;
  const lloyBaseline = cy - MARK_FINAL * 0.22;   // upper (gray A) line — well clear of entors
  const entorsBaseline = cy + MARK_FINAL * 0.62; // lower (orange M) line

  const markSize = useSharedValue(MARK_BIG);
  const markCX = useSharedValue(cx);
  const textOpacity = useSharedValue(0);
  const textDX = useSharedValue(-16);
  const wipe = useSharedValue(0);

  const finish = () => {
    if (calledDone.current) return;
    calledDone.current = true;
    onDone();
  };

  const startFlip = () => {
    setPhase('flip');
    try {
      const img = canvasRef.current?.makeImageSnapshot();
      const b64 = img?.encodeToBase64();
      if (b64) setSnapshot(`data:image/png;base64,${b64}`);
    } catch {
      /* tiles fall back to a solid pine base — see FlipTile */
    }
  };

  // Logo choreography.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    AccessibilityInfo.isReduceMotionEnabled?.().then((reduced) => {
      if (cancelled) return;

      if (reduced) {
        markSize.value = MARK_FINAL;
        markCX.value = markCXFinal;
        textOpacity.value = 1;
        textDX.value = 0;
        timer = setTimeout(startFlip, 900);
        return;
      }

      const ease = Easing.out(Easing.cubic);
      markSize.value = withDelay(HOLD_BIG, withTiming(MARK_FINAL, { duration: RESOLVE, easing: ease }));
      markCX.value = withDelay(HOLD_BIG, withTiming(markCXFinal, { duration: RESOLVE, easing: ease }));
      textOpacity.value = withDelay(HOLD_BIG + 350, withTiming(1, { duration: RESOLVE - 250, easing: ease }));
      textDX.value = withDelay(HOLD_BIG + 350, withTiming(0, { duration: RESOLVE - 250, easing: ease }));

      timer = setTimeout(startFlip, FLIP_START_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Reveal wipe — delayed a beat past the snapshot capture so the (identical,
  // cached) tile images have time to decode before any tile starts fading;
  // every tile also has an opaque pine base regardless, as a second guard.
  useEffect(() => {
    if (phase !== 'flip') return;
    const t = setTimeout(() => {
      wipe.value = withTiming(1, { duration: FLIP_MS, easing: Easing.linear }, (d) => {
        if (d) runOnJS(finish)();
      });
    }, DECODE_GUARD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Skia-driven props.
  const mSize = useDerivedValue(() => markSize.value);
  const mX = useDerivedValue(() => markCX.value - markSize.value / 2);
  const mY = useDerivedValue(() => cy - markSize.value / 2);
  const lloyX = useDerivedValue(() => lloyXFinal + textDX.value);
  const entorsX = useDerivedValue(() => entorsXFinal + textDX.value);
  const textOp = useDerivedValue(() => textOpacity.value);

  const tiles = useMemo<Tile[]>(() => {
    const tw = W / COLS;
    const th = H / ROWS;
    const arr: Tile[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        arr.push({ key: `${r}-${c}`, left: c * tw, top: r * th, tw, th, sf: c / (COLS - 1) });
      }
    }
    return arr;
  }, [W, H]);

  if (!ready) {
    return (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={W} height={H} color={PINE} />
      </Canvas>
    );
  }

  if (phase === 'logo') {
    return (
      <Canvas ref={canvasRef} style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none">
        <Rect x={0} y={0} width={W} height={H} color={PINE} />
        <SkiaImage image={markImage} x={mX} y={mY} width={mSize} height={mSize} fit="contain" />
        <Group opacity={textOp}>
          <SkiaText text="lloy" x={lloyX} y={lloyBaseline} font={lloyFont} color={SILVER} />
          <SkiaText text="entors" x={entorsX} y={entorsBaseline} font={entorsFont} color={CLAY} />
        </Group>
      </Canvas>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none">
      {tiles.map((t) => (
        <WipeTile key={t.key} tile={t} wipe={wipe} snapshot={snapshot} W={W} H={H} />
      ))}
    </View>
  );
}

/** One tile of the reveal sweep. Always has an opaque pine base — the
 *  snapshot slice layers on top of it once decoded, never instead of it —
 *  so there is no frame where a not-yet-decoded tile lets the app underneath
 *  show through. Fades out left → right on an accelerating (ease-in) curve:
 *  holds near-opaque, then rapidly clears. */
const WipeTile = React.memo(function WipeTile({
  tile,
  wipe,
  snapshot,
  W,
  H,
}: {
  tile: Tile;
  wipe: SharedValue<number>;
  snapshot: string | null;
  W: number;
  H: number;
}) {
  const { left, top, tw, th, sf } = tile;
  const style = useAnimatedStyle(() => {
    'worklet';
    const local = Math.max(0, Math.min(1, wipe.value * (1 + SPREAD) - sf * SPREAD));
    const opacity = 1 - Math.pow(local, 2.4); // accelerating fade
    return { opacity };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: tw + 0.6, // tiny overlap kills subpixel seams
          height: th + 0.6,
          overflow: 'hidden',
          backgroundColor: PINE, // always-present opaque base
        },
        style,
      ]}
    >
      {snapshot && (
        <Image source={{ uri: snapshot }} style={{ position: 'absolute', left: -left, top: -top, width: W, height: H }} />
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: { zIndex: 999, elevation: 999, backgroundColor: 'transparent' },
});
