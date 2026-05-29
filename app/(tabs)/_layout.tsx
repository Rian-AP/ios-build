import { usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { DynamicColorIOS, Platform, type ColorValue } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function TabLayout() {
  const { t } = useI18n();
  const pathname = usePathname();
  const theme = useTheme();

  // Haptic on tab switch — skip initial mount
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    const tabRoots = ['/', '/search', '/library', '/downloads', '/settings'];
    const isTabRoot = tabRoots.some(
      (root) => pathname === root || pathname.startsWith(root + '/')
    );
    if (!isTabRoot) return;
    if (prevPathnameRef.current === null) {
      prevPathnameRef.current = pathname;
      return;
    }
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      void Haptics.selectionAsync().catch(() => {});
    }
  }, [pathname]);
  const tabAccent = theme.colors.accent;
  const tabMuted = theme.colors.muted;
  const tabAccentSurface = theme.colors.accentSurface;
  const isSearchRoute = pathname === '/search' || pathname.startsWith('/search/');
  const nativeAccent: ColorValue =
    Platform.OS === 'ios' ? DynamicColorIOS({ light: tabAccent, dark: tabAccent }) : tabAccent;
  const nativeMuted: ColorValue =
    Platform.OS === 'ios' ? DynamicColorIOS({ light: tabMuted, dark: tabMuted }) : tabMuted;
  const nativeAccentSurface: ColorValue =
    Platform.OS === 'ios'
      ? DynamicColorIOS({ light: tabAccentSurface, dark: tabAccentSurface })
      : tabAccentSurface;
  const tabDefaultIconColor = (Platform.OS === 'ios' && isSearchRoute) ? nativeAccent : nativeMuted;
  const homeIcon = (Platform.OS === 'ios' && isSearchRoute) ? 'house.fill' : 'house';
  const libraryIcon = (Platform.OS === 'ios' && isSearchRoute) ? 'bookmark.fill' : 'bookmark';
  const downloadsIcon = (Platform.OS === 'ios' && isSearchRoute) ? 'arrow.down.circle.fill' : 'arrow.down.circle';
  const settingsIcon = (Platform.OS === 'ios' && isSearchRoute) ? 'gearshape.fill' : 'gearshape';
  const minimizeBehavior =
    Platform.OS === 'ios' && isSearchRoute ? 'never' : 'onScrollDown';

  return (
    <NativeTabs
      minimizeBehavior={minimizeBehavior}
      blurEffect="systemChromeMaterial"
      backgroundColor={theme.colors.chrome}
      tintColor={nativeAccent}
      iconColor={{ default: tabDefaultIconColor, selected: nativeAccent }}
      indicatorColor={nativeAccentSurface}
      rippleColor={nativeAccentSurface}
      badgeBackgroundColor={nativeAccent}
      badgeTextColor={theme.colors.onAccent}
      labelStyle={{
        default: { color: nativeMuted, fontSize: 11, fontWeight: '600' },
        selected: { color: nativeAccent, fontSize: 11, fontWeight: '700' },
      }}
      shadowColor={theme.colors.border}
    >
      <NativeTabs.Trigger name="index" onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})}>
        <NativeTabs.Trigger.Icon
          sf={{ default: homeIcon, selected: 'house.fill' }}
          md="home"
          selectedColor={nativeAccent}
        />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="search"
        role="search"
        disableScrollToTop
        disableAutomaticContentInsets
        onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})}
      >
        <NativeTabs.Trigger.Icon
          sf="magnifyingglass"
          md="search"
          selectedColor={nativeAccent}
        />
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="library" onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})}>
        <NativeTabs.Trigger.Icon
          sf={{ default: libraryIcon, selected: 'bookmark.fill' }}
          md="bookmarks"
          selectedColor={nativeAccent}
        />
        <NativeTabs.Trigger.Label>{t('tabs.library')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="downloads" onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})}>
        <NativeTabs.Trigger.Icon
          sf={{ default: downloadsIcon, selected: 'arrow.down.circle.fill' }}
          md="download"
          selectedColor={nativeAccent}
        />
        <NativeTabs.Trigger.Label>{t('tabs.downloads')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings" onLongPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})}>
        <NativeTabs.Trigger.Icon
          sf={{ default: settingsIcon, selected: 'gearshape.fill' }}
          md="settings"
          selectedColor={nativeAccent}
        />
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
