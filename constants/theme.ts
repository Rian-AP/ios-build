const musicAccent = '#7E57C2';
const musicAccentRgb = '126,87,194';

export const typography = {
  display: undefined,
  heading: undefined,
  subheading: undefined,
  body: undefined,
  bodyMedium: undefined,
  mono: undefined,
};

export const lightColors = {
  background: '#F5F5F7',
  backgroundAlt: '#FFFFFF',
  panel: '#FFFFFF',
  panelSoft: '#EFEFF4',
  text: '#111113',
  muted: '#6E6E73',
  accent: musicAccent,
  indicator: musicAccent,
  accentRefresh: '#9A79D3',
  accentSoft: '#4A2E8E',
  accentSurface: `rgba(${musicAccentRgb},0.12)`,
  border: 'rgba(60,60,67,0.16)',
  success: '#248A3D',
  onAccent: '#FFFFFF',
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',
  dangerText: '#B91C1C',
  dangerMuted: '#7F1D1D',
  menuSurface: 'rgba(255,255,255,0.84)',
  menuBorder: 'rgba(255,255,255,0.64)',
  menuSeparator: 'rgba(60,60,67,0.18)',
  warningSurface: '#FFF3CD',
  warningText: '#8A4B00',
  shadow: '#000000',
  chrome: 'rgba(255,255,255,0.72)',
  elevated: '#FFFFFF',
  secondaryText: '#3A3A3C',
  albumShadow: 'rgba(0,0,0,0.18)',
  playbackSurface: '#050506',
  playbackText: '#F5F5F7',
  heroGradientTop: 'rgba(0,0,0,0.00)',
  heroGradientMiddle: 'rgba(0,0,0,0.20)',
  heroGradientBottom: 'rgba(10,12,16,0.90)',
  heroMetaText: 'rgba(255,255,255,0.92)',
  heroTitleText: '#FFFFFF',
  heroSynopsisText: 'rgba(255,255,255,0.9)',
  heroDubBadgeBg: 'rgba(255,255,255,0.14)',
  heroDubBadgeBorder: 'rgba(255,255,255,0.18)',
  heroDubBadgeText: '#FFFFFF',
  heroProgressTrack: 'rgba(255,255,255,0.28)',
};

export const darkColors = {
  background: '#050506',
  backgroundAlt: '#111114',
  panel: '#1C1C1E',
  panelSoft: '#2C2C2E',
  text: '#F5F5F7',
  muted: '#A1A1A6',
  accent: musicAccent,
  indicator: musicAccent,
  accentRefresh: '#9A79D3',
  accentSoft: musicAccent,
  accentSurface: `rgba(${musicAccentRgb},0.12)`,
  border: 'rgba(255,255,255,0.12)',
  success: '#34D399',
  onAccent: '#FFFFFF',
  dangerBg: '#2A1014',
  dangerBorder: '#5C2130',
  dangerText: '#FCA5A5',
  dangerMuted: '#FECACA',
  menuSurface: 'rgba(28,28,30,0.82)',
  menuBorder: 'rgba(255,255,255,0.12)',
  menuSeparator: 'rgba(255,255,255,0.1)',
  warningSurface: '#3A2A08',
  warningText: '#FDE68A',
  shadow: '#000000',
  chrome: 'rgba(28,28,30,0.76)',
  elevated: '#232326',
  secondaryText: '#D1D1D6',
  albumShadow: 'rgba(0,0,0,0.48)',
  playbackSurface: '#000000',
  playbackText: '#F5F5F7',
  heroGradientTop: 'rgba(0,0,0,0.02)',
  heroGradientMiddle: 'rgba(0,0,0,0.34)',
  heroGradientBottom: 'rgba(8,8,8,0.96)',
  heroMetaText: 'rgba(255,255,255,0.92)',
  heroTitleText: '#FFFFFF',
  heroSynopsisText: 'rgba(255,255,255,0.9)',
  heroDubBadgeBg: 'rgba(255,255,255,0.14)',
  heroDubBadgeBorder: 'rgba(255,255,255,0.18)',
  heroDubBadgeText: '#FFFFFF',
  heroProgressTrack: 'rgba(255,255,255,0.28)',
};

export const lightTheme = {
  typography,
  colors: lightColors,
};

export const darkTheme = {
  typography,
  colors: darkColors,
};

export type AppTheme = typeof lightTheme;
export type AppColors = typeof lightColors;

export const theme = lightTheme;
