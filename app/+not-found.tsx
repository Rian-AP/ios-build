import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export default function NotFoundScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <>
      <Stack.Screen options={{ title: t("notFound.title") }} />
      <View style={styles.container}>
        <EmptyState title={t("notFound.title")} body={t("notFound.message")} />

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>{t("notFound.action")}</Text>
        </Link>
      </View>
    </>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      backgroundColor: theme.colors.background,
    },
    link: {
      marginTop: 15,
      paddingVertical: 15,
    },
    linkText: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.accent,
    },
  });
