import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Image, StyleSheet, Text, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font } from '@/lib/theme';

const PINE = '#165B74';
const CREAM = '#F4F6F6';

const LARGE = 176;
const SMALL = 56;
const GAP = 8; // tight — the mark should read as the "A" the text continues from

const HOLD_MS = 280;   // beat on the big centered mark before it moves
const MOVE_MS = 680;   // shrink + relocate
const TEXT_MS = 460;   // "lloy" / "Mentors" reveal
const SETTLE_MS = 500; // hold the finished lockup
const FADE_MS = 380;   // whole overlay fades to reveal the app underneath

/**
 * Cold-launch brand moment: the mark opens large and centered (continuing
 * visually from the native splash, which uses the same image + background),
 * then shrinks into the header position while "lloy" / "Mentors" complete
 * the wordmark next to it — the mark IS the "A", the same way Midtown
 * Athletic Club's app resolves its M into "idtown / Athletic Club".
 */
export function IntroSplash({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const calledDone = useRef(false);

  const targetLeft = 28;
  const targetTop = insets.top + 20;
  const centerXFinal = targetLeft + SMALL / 2;
  const centerYFinal = targetTop + SMALL / 2;
  const centerXInitial = width / 2;
  const centerYInitial = height / 2 - 36;

  const scale = useSharedValue(1);
  const left = useSharedValue(centerXInitial - LARGE / 2);
  const top = useSharedValue(centerYInitial - LARGE / 2);
  const textOpacity = useSharedValue(0);
  const textTranslate = useSharedValue(8);
  const overlayOpacity = useSharedValue(1);

  const finish = () => {
    if (calledDone.current) return;
    calledDone.current = true;
    onDone();
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then((reduced) => {
      if (reduced) {
        scale.value = SMALL / LARGE;
        left.value = centerXFinal - LARGE / 2;
        top.value = centerYFinal - LARGE / 2;
        textOpacity.value = 1;
        textTranslate.value = 0;
        overlayOpacity.value = withDelay(500, withTiming(0, { duration: FADE_MS }, (done) => {
          if (done) runOnJS(finish)();
        }));
        return;
      }

      const ease = Easing.out(Easing.cubic);
      scale.value = withDelay(HOLD_MS, withTiming(SMALL / LARGE, { duration: MOVE_MS, easing: ease }));
      left.value = withDelay(HOLD_MS, withTiming(centerXFinal - LARGE / 2, { duration: MOVE_MS, easing: ease }));
      top.value = withDelay(HOLD_MS, withTiming(centerYFinal - LARGE / 2, { duration: MOVE_MS, easing: ease }));

      const textDelay = HOLD_MS + MOVE_MS - 140;
      textOpacity.value = withDelay(textDelay, withTiming(1, { duration: TEXT_MS, easing: ease }));
      textTranslate.value = withDelay(textDelay, withTiming(0, { duration: TEXT_MS, easing: ease }));

      overlayOpacity.value = withDelay(
        HOLD_MS + MOVE_MS + TEXT_MS + SETTLE_MS,
        withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(finish)();
        })
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: left.value,
    top: top.value,
    width: LARGE,
    height: LARGE,
    transform: [{ scale: scale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: targetLeft + SMALL + GAP,
    top: centerYFinal - 22,
    opacity: textOpacity.value,
    transform: [{ translateX: textTranslate.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, styles.screen, overlayStyle]} pointerEvents="none">
      <Animated.View style={markStyle}>
        <Image
          source={require('@/assets/images/splash-icon.png')}
          style={{ width: LARGE, height: LARGE }}
          resizeMode="contain"
        />
      </Animated.View>

      <Animated.View style={textStyle}>
        <Text style={styles.lloy}>lloy</Text>
        <Text style={styles.mentors}>Mentors</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: PINE, zIndex: 999, elevation: 999 },
  lloy: {
    fontFamily: font.black,
    fontSize: 26,
    color: CREAM,
    letterSpacing: -0.6,
    lineHeight: 28,
  },
  mentors: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    color: 'rgba(244,246,246,0.7)',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});
