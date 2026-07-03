/**
 * Alloy — "cream & pine" editorial design system.
 *
 * Calm, paper-like surfaces (warm cream), deep pine-green as the single brand
 * accent, and dark ink type. Flat cards with hairline pine rules instead of
 * glass. A small set of semantic accents (pine / ochre / clay / slate) carry
 * status only (going, pending, rejected, secondary stats).
 */

export const colors = {
  // Base — warm cream paper (the calm editorial ground)
  base: '#F2ECDE',
  baseElevated: '#FBF6EC',

  // Soft paper facets (kept for the AuroraBackground washes)
  facetDark: '#EDE6D6',
  facetMid: '#F0EADC',
  facetLit: '#F7F2E8',
  facetEdge: 'rgba(43,70,56,0.06)',

  // Card surfaces — solid warm ivory, readable on cream without any blur
  surface: '#FBF6EC',        // resting cards
  surfaceStrong: '#FFFDF7',  // elevated / modal cards
  hairline: 'rgba(43,70,56,0.14)',       // pine hairline rule
  hairlineStrong: 'rgba(43,70,56,0.26)',

  // Depth cues — soft, warm, barely-there (editorial, not neumorphic)
  highlight: 'rgba(255,255,255,0.55)', // faint paper sheen on a raised edge
  shadowDeep: 'rgba(43,55,45,0.14)',

  // Modal scrim — a soft warm dim over the cream, never a heavy black-out
  scrim: 'rgba(30,36,28,0.42)',

  // Pine + neutrals (the brand body)
  platinum: '#375946', // primary pine accent (buttons / FAB / bars / ripple)
  silver: '#6E7C6F',   // muted sage (labels, secondary text, tracks)
  steel: '#8A9187',    // tertiary sage-gray
  graphite: '#2C322B', // deep ink-green
  titanium: '#AFC0AE', // soft sage kept in the background wash

  // Semantic accents (status only — muted, readable on cream + ivory)
  mint: '#3E6A52', // approved / going / success (pine-green)
  sky: '#5E7488',  // info / secondary
  iris: '#5E7488', // secondary stat (slate)
  gold: '#B08A3E', // pending / warning (ochre)
  rose: '#B15A4E', // rejected / not-going (clay)

  // Text — dark ink on paper
  text: '#22271F',
  textDim: 'rgba(34,39,31,0.62)',
  textFaint: 'rgba(34,39,31,0.42)',
  textGhost: 'rgba(34,39,31,0.26)',
} as const;

/** Pine gradient — brand mark, primary buttons, FAB. Reads as deep forest. */
export const alloyGradient = ['#4A7059', '#375946', '#284035'] as const;
/** Alias, semantic name. */
export const metalGradient = alloyGradient;
/** Faint sage wash used by the aurora backdrop. */
export const auroraMetals = ['#CFD8C4', '#AFC0AE', '#8A9187'] as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export const font = {
  black: 'Inter-Black',
  bold: 'Inter-Bold',
  semibold: 'Inter-SemiBold',
  medium: 'Inter-Medium',
  regular: 'Inter-Regular',
} as const;

/** Reanimated spring presets — consistent motion language across the app. */
export const motion = {
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  soft: { damping: 16, stiffness: 180, mass: 0.9 },
  bouncy: { damping: 12, stiffness: 220, mass: 0.8 },
} as const;

/**
 * Soft editorial "lifted card" shadow — a gentle, warm drop so cards sit just
 * above the paper without the heavy neumorphic pooling of the old dark theme.
 */
export const raised = {
  shadowColor: '#2B3325',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.10,
  shadowRadius: 14,
  elevation: 4,
} as const;

/** Standard translucent tint for an accent colour at a given alpha (0-1). */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
