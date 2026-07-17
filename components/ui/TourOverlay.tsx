import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, font, radius, space } from '@/lib/theme';
import { GlassButton } from '@/components/ui/GlassButton';
import {
  TOUR_STEPS,
  hasSeenTour,
  markTourSeen,
  tourAudienceForRole,
} from '@/lib/tours';
import type { UserRole } from '@/lib/roles';

interface TourOverlayProps {
  /** The signed-in user's role — mapped to the right audience internally. */
  role?: UserRole | string | null;
  /** Called when the tour is finished or skipped (seen flag already written). */
  onDone: () => void;
  /**
   * Force the tour to show even if already seen (dev/preview). Defaults to
   * false, i.e. only shows on the first run for this role.
   */
  force?: boolean;
}

/**
 * First-run coachmark overlay.
 *
 * Drop it near the top of a screen (e.g. the home tab):
 *
 *   <TourOverlay role={profile?.role} onDone={() => {}} />
 *
 * On mount it checks `hasSeenTour(role)`. If unseen (or `force`), it renders a
 * full-screen dimmed modal that steps through `TOUR_STEPS` for the role with
 * Next / Skip controls and a progress-dot indicator, then writes the seen flag
 * and calls `onDone`. If already seen, it renders nothing.
 */
export function TourOverlay({ role, onDone, force = false }: TourOverlayProps) {
  const audience = tourAudienceForRole(role);
  const steps = TOUR_STEPS[audience];

  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (force) {
        if (!cancelled) setVisible(true);
        return;
      }
      const seen = await hasSeenTour(role);
      if (!cancelled && !seen) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
    // Re-evaluate if the role audience changes.
  }, [role, force, audience]);

  const finish = async () => {
    setVisible(false);
    await markTourSeen(role);
    onDone();
  };

  const handleNext = () => {
    if (index >= steps.length - 1) {
      void finish();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const handleSkip = () => {
    void finish();
  };

  if (!visible || steps.length === 0) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleSkip}>
      {/* Blurred, dimmed backdrop — same BlurView pattern used elsewhere in the
          app, over a solid scrim so the card never composites muddy. */}
      <View style={styles.backdrop}>
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} />

        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.card}>
            <Text style={styles.eyebrow}>
              {audience === 'admin' ? 'ADMIN TOUR' : audience === 'student' ? 'STUDENT TOUR' : 'MENTOR TOUR'}
            </Text>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.body}</Text>

            {/* Progress dots */}
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === index ? styles.dotActive : null]}
                />
              ))}
            </View>

            <GlassButton
              title={isLast ? 'Get started' : 'Next'}
              onPress={handleNext}
              style={{ marginTop: space.md }}
            />

            <Pressable onPress={handleSkip} hitSlop={10} style={styles.skipBtn}>
              <Text style={styles.skipTxt}>
                {isLast ? 'Close' : 'Skip tour'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default TourOverlay;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 26,
  },
  eyebrow: {
    fontFamily: font.bold,
    fontSize: 11,
    letterSpacing: 3,
    color: colors.mint,
    marginBottom: 10,
  },
  title: {
    fontFamily: font.black,
    fontSize: 23,
    color: colors.text,
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textDim,
  },
  dots: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 22,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.hairlineStrong,
  },
  dotActive: {
    backgroundColor: colors.platinum,
    width: 20,
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  skipTxt: {
    fontFamily: font.medium,
    fontSize: 14,
    color: colors.textFaint,
  },
});
