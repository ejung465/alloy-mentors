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
const LLOY_SIZE = Math.round(MARK_FINAL * 0.34);
const ENTORS_SIZE = Math.round(MARK_FINAL * 0.42);

// Timeline (ms from mount).
const HOLD_BIG = 500;      // hold the big centered "A"
const RESOLVE = 1400;      // shrink + slide left, wordmark emerges
const FLIP_START_MS = 4500; // background-load window before the reveal
const FLIP_MS = 1300;      // flipboard reveal duration

// Flipboard grid — ~136 tiles (COLS*ROWS).
const COLS = 8;
const ROWS = 17;
const SPREAD = 0.6; // how much the diagonal stagger overlaps

type Tile = { key: string; left: number; top: number; tw: number; th: number; sf: number };

/**
 * Cold-launch brand moment.
 *
 * 1. Opens on the big "A" mark, dead-center.
 * 2. It shrinks slightly and slides left to a centered lockup while the
 *    wordmark resolves out of the mark — "lloy" (gray, off the upper A) and
 *    "entors" (orange, off the lower M) — so the mark reads as both letters.
 * 3. Holds ~4.5s (the app loads underneath the overlay).
 * 4. The whole screen splits into a grid of tiles that flip 180° in a
 *    diagonal wave — a split-flap board — revealing the ready home screen.
 *
 * The overlay lives above the router Stack (see app/_layout.tsx), so the tiles
 * uncover the real, already-mounted destination. Respects Reduce Motion.
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

  const entorsW = entorsFont ? entorsFont.getTextWidth('entors') : MARK_FINAL * 1.2;

  // Final lockup geometry (mark just left of center, wordmark to its right).
  const textStartOffset = MARK_FINAL * 0.6; // text tucks near the mark's right leg
  const lockupW = Math.max(MARK_FINAL, textStartOffset + entorsW + 6);
  const markCXFinal = cx - lockupW / 2 + MARK_FINAL / 2;
  const markLeftFinal = markCXFinal - MARK_FINAL / 2;
  const lloyXFinal = markLeftFinal + MARK_FINAL * 0.6;
  const entorsXFinal = markLeftFinal + MARK_FINAL * 0.64;
  const lloyBaseline = cy - MARK_FINAL * 0.05; // upper (gray A) line
  const entorsBaseline = cy + MARK_FINAL * 0.42; // lower (orange M) line

  const markSize = useSharedValue(MARK_BIG);
  const markCX = useSharedValue(cx);
  const textOpacity = useSharedValue(0);
  const textDX = useSharedValue(-16);
  const flip = useSharedValue(0);

  const finish = () => {
    if (calledDone.current) return;
    calledDone.current = true;
    onDone();
  };

  const startFlip = () => {
    // Snapshot the settled logo screen so the tiles carry its pixels as they
    // flip. Falls back to solid pine tiles if the snapshot is unavailable.
    try {
      const img = canvasRef.current?.makeImageSnapshot();
      const b64 = img?.encodeToBase64();
      if (b64) setSnapshot(`data:image/png;base64,${b64}`);
    } catch {
      /* fall through to solid-pine tiles */
    }
    setPhase('flip');
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
        timer = setTimeout(startFlip, 1400);
        return;
      }

      const ease = Easing.out(Easing.cubic);
      markSize.value = withDelay(HOLD_BIG, withTiming(MARK_FINAL, { duration: RESOLVE, easing: ease }));
      markCX.value = withDelay(HOLD_BIG, withTiming(markCXFinal, { duration: RESOLVE, easing: ease }));
      textOpacity.value = withDelay(HOLD_BIG + 300, withTiming(1, { duration: RESOLVE - 200, easing: ease }));
      textDX.value = withDelay(HOLD_BIG + 300, withTiming(0, { duration: RESOLVE - 200, easing: ease }));

      timer = setTimeout(startFlip, FLIP_START_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Flipboard reveal.
  useEffect(() => {
    if (phase !== 'flip') return;
    flip.value = withTiming(1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) }, (d) => {
      if (d) runOnJS(finish)();
    });
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
    const denom = (ROWS - 1) + (COLS - 1);
    const arr: Tile[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        arr.push({ key: `${r}-${c}`, left: c * tw, top: r * th, tw, th, sf: (r + c) / denom });
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
        <FlipTile key={t.key} tile={t} flip={flip} snapshot={snapshot} W={W} H={H} />
      ))}
    </View>
  );
}

/** One flipping tile of the board. Front carries its slice of the logo screen;
 *  once it rotates past edge-on it hides, revealing the app underneath. */
const FlipTile = React.memo(function FlipTile({
  tile,
  flip,
  snapshot,
  W,
  H,
}: {
  tile: Tile;
  flip: SharedValue<number>;
  snapshot: string | null;
  W: number;
  H: number;
}) {
  const { left, top, tw, th, sf } = tile;
  const style = useAnimatedStyle(() => {
    'worklet';
    const local = Math.max(0, Math.min(1, flip.value * (1 + SPREAD) - sf * SPREAD));
    const deg = local * 100; // past 90° so the back face is hidden
    return {
      opacity: local >= 1 ? 0 : 1,
      transform: [{ perspective: 700 }, { rotateX: `${deg}deg` }],
    };
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
          backfaceVisibility: 'hidden',
        },
        style,
      ]}
    >
      {snapshot ? (
        <Image source={{ uri: snapshot }} style={{ position: 'absolute', left: -left, top: -top, width: W, height: H }} />
      ) : (
        <View style={{ width: tw + 0.6, height: th + 0.6, backgroundColor: PINE }} />
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  overlay: { zIndex: 999, elevation: 999, backgroundColor: 'transparent' },
});
