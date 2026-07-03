/**
 * Alloy — "harbor" editorial design system.
 *
 * Calm, cool gray-white surfaces, deep harbor-blue as the single brand
 * accent (from the logo mark), warm orange as the one accent color, and
 * dark ink type. Flat cards with hairline gray rules instead of glass.
 * A small set of semantic accents (gold / clay) carry status only
 * (pending, rejected) and are deliberately kept apart from the brand
 * palette so error/warning states stay legible at a glance.
 */

export const colors = {
  // Base — cool gray-white (the calm editorial ground)
  base: '#F1F1EF',
  baseElevated: '#F7F8F8',

  // Soft facets (kept for the AuroraBackground washes)
  facetDark: '#E7E8E7',
  facetMid: '#EDEEED',
  facetLit: '#F7F8F8',
  facetEdge: 'rgba(196,196,196,0.10)',

  // Card surfaces — solid cool white, readable on gray-white without any blur
  surface: '#F7F8F8',        // resting cards
  surfaceStrong: '#FFFFFF',  // elevated / modal cards
  hairline: 'rgba(196,196,196,0.35)',       // gray hairline rule
  hairlineStrong: 'rgba(196,196,196,0.55)',

  // Depth cues — soft, cool, barely-there (editorial, not neumorphic)
  highlight: 'rgba(255,255,255,0.55)', // faint paper sheen on a raised edge
  shadowDeep: 'rgba(20,30,35,0.14)',

  // Modal scrim — a soft dim over the gray-white, never a heavy black-out
  scrim: 'rgba(20,26,30,0.42)',

  // Harbor blue + neutrals (the brand body)
  platinum: '#165B74', // primary harbor-blue accent (buttons / FAB / bars / ripple)
  silver: '#7A7A7A',   // muted gray (labels, secondary text, tracks)
  steel: '#8C8C8C',    // tertiary gray
  graphite: '#14232B', // deep ink-blue
  titanium: '#C4C4C4', // logo gray kept in the background wash

  // Semantic accents (status only — muted, readable on gray-white + white)
  mint: '#2C7C96',  // approved / going / success (harbor mid-blue)
  sky: '#7A7A7A',   // info / secondary (gray)
  iris: '#7A7A7A',  // secondary stat (gray)
  gold: '#B08A3E',  // pending / warning (ochre — unchanged, functional)
  rose: '#B15A4E',  // rejected / not-going (clay — unchanged, functional)

  // Text — dark ink on paper
  text: '#22271F',
  textDim: 'rgba(34,39,31,0.62)',
  textFaint: 'rgba(34,39,31,0.42)',
  textGhost: 'rgba(34,39,31,0.26)',
} as const;

/** Harbor-blue gradient — brand mark, primary buttons, FAB. */
export const alloyGradient = ['#2C7C96', '#165B74', '#0E3E4F'] as const;
/** Alias, semantic name. */
export const metalGradient = alloyGradient;
/** Faint gray wash used by the aurora backdrop. */
export const auroraMetals = ['#E7E8E7', '#C4C4C4', '#8C8C8C'] as const;

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
