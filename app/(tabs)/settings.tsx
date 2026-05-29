import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui';
import { AppLanguage, useI18n } from '@/lib/i18n';
import { ThemeMode, useTheme, useThemeController } from '@/lib/theme';

type ThemeOption = {
  value: ThemeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type LanguageOption = {
  value: AppLanguage;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  emoji?: string;
};

export default function SettingsScreen() {
  const { language, setLanguage, t } = useI18n();
  const theme = useTheme();
  const { themeMode, setThemeMode, accentHue, setAccentHue } = useThemeController();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const themeOptions = useMemo<ThemeOption[]>(
    () => [
      { value: 'system', label: t('settings.themeSystem'), icon: 'contrast-outline' },
      { value: 'light', label: t('settings.themeLight'), icon: 'sunny-outline' },
      { value: 'dark', label: t('settings.themeDark'), icon: 'moon-outline' },
    ],
    [t]
  );

  const languageOptions = useMemo<LanguageOption[]>(
    () => [
      { value: 'ru', label: t('settings.russian'), icon: 'globe-outline', emoji: '🇷🇺' },
      { value: 'en', label: t('settings.english'), icon: 'globe-outline', emoji: '🇬🇧' },
    ],
    [t]
  );

  const selectThemeMode = (value: ThemeMode) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setThemeMode(value);
  };

  const selectLanguage = (value: AppLanguage) => {
    void Haptics.selectionAsync().catch(() => undefined);
    setLanguage(value);
  };

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={Platform.OS === 'android' ? ['top', 'left', 'right'] : ['left', 'right']}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.container}>
        <ScreenHeader title={t('tabs.settings')} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.accent')}</Text>
          <View style={styles.listCard}>
            <View style={styles.sliderRow}>
              <View style={[styles.accentPreview, { backgroundColor: theme.colors.accent }]} />
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={360}
                step={1}
                value={accentHue}
                onValueChange={setAccentHue}
                minimumTrackTintColor={theme.colors.accent}
                maximumTrackTintColor={theme.colors.border}
                thumbTintColor={theme.colors.accent}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.theme')}</Text>
          <View style={styles.listCard}>
            {themeOptions.map((option, index) => {
              const selected = option.value === themeMode;
              const isLast = index === themeOptions.length - 1;

              return (
                <Pressable
                  key={option.value}
                  style={[styles.row, !isLast && styles.rowDivider]}
                  onPress={() => selectThemeMode(option.value)}
                  >
                  <View style={styles.leadingIconWrap}>
                    <Ionicons name={option.icon} size={26} color={selected ? theme.colors.accent : theme.colors.text} />
                  </View>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={32}
                    color={selected ? theme.colors.accent : theme.colors.muted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <View style={styles.listCard}>
            {languageOptions.map((option, index) => {
              const selected = option.value === language;
              const isLast = index === languageOptions.length - 1;

              return (
                <Pressable
                  key={option.value}
                  style={[styles.row, !isLast && styles.rowDivider]}
                  onPress={() => selectLanguage(option.value)}
                  >
                  <View style={styles.leadingIconWrap}>
                    {option.emoji ? (
                      <Text style={styles.flagEmoji}>{option.emoji}</Text>
                    ) : (
                      <Ionicons name={option.icon} size={24} color={selected ? theme.colors.accent : theme.colors.text} />
                    )}
                  </View>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={32}
                    color={selected ? theme.colors.accent : theme.colors.muted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    container: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 32,
      gap: 16,
    },
    section: {
      gap: 10,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontWeight: '800',
      fontSize: 20,
      lineHeight: 25,
    },
    listCard: {
      backgroundColor: theme.colors.panel,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    row: {
      minHeight: 74,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    leadingIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: theme.colors.panelSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      flex: 1,
      color: theme.colors.text,
      fontWeight: '700',
      fontSize: 17,
    },
    flagEmoji: {
      fontSize: 20,
      lineHeight: 24,
    },
    sliderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    accentPreview: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    slider: {
      flex: 1,
      height: 40,
    },
  });
