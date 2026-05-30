import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/lib/theme";

type ActionProps = {
  label: string;
  onPress: () => void;
};

type AccountButtonProps = {
  onPress: () => void;
  /** User initials to show when logged in (e.g. "AV"). If absent → person icon. */
  initials?: string | null;
  size?: "default" | "large";
};

export function ScreenHeader({
  title,
  action,
  accountButton,
}: {
  title: string;
  action?: ActionProps;
  accountButton?: AccountButtonProps;
}) {
  const theme = useTheme();
  const accountButtonLarge = accountButton?.size === "large";

  return (
    <View style={screenHeaderStyles.wrap}>
      <View style={screenHeaderStyles.copy}>
        <Text
          selectable
          numberOfLines={1}
          style={[screenHeaderStyles.title, { color: theme.colors.text }]}
        >
          {title}
        </Text>
      </View>

      <View style={screenHeaderStyles.right}>
        {action ? (
          Platform.OS === 'ios' && isGlassEffectAPIAvailable() ? (
            <GlassView
              style={screenHeaderStyles.trashGlass}
              glassEffectStyle="regular"
              isInteractive
            >
              <Pressable
                onPress={action.onPress}
                hitSlop={8}
                style={screenHeaderStyles.trashBtn}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={theme.colors.accent}
                />
              </Pressable>
            </GlassView>
          ) : (
            <Pressable
              onPress={action.onPress}
              hitSlop={8}
              style={screenHeaderStyles.trashBtn}
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color={theme.colors.accent}
              />
            </Pressable>
          )
        ) : null}

        {accountButton ? (
          <Pressable
            onPress={accountButton.onPress}
            style={[
              screenHeaderStyles.accountBtn,
              accountButtonLarge ? screenHeaderStyles.accountBtnLarge : null,
            ]}
            hitSlop={8}
          >
            <LinearGradient
              colors={["#A8C1E1", "#7680BA"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={screenHeaderStyles.accountGradient}
            >
              {accountButton.initials ? (
                <Text
                  style={[
                    screenHeaderStyles.accountInitials,
                    accountButtonLarge ? screenHeaderStyles.accountInitialsLarge : null,
                  ]}
                >
                  {accountButton.initials.slice(0, 2).toUpperCase()}
                </Text>
              ) : (
                <Ionicons
                  name="person"
                  size={accountButtonLarge ? 22 : 17}
                  color="#FFFFFF"
                />
              )}
            </LinearGradient>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: string | number;
}) {
  const theme = useTheme();

  return (
    <View style={sectionHeaderStyles.wrap}>
      <Text
        selectable
        style={[sectionHeaderStyles.title, { color: theme.colors.text }]}
      >
        {title}
      </Text>
      {meta != null ? (
        <Text style={[sectionHeaderStyles.meta, { color: theme.colors.muted }]}>
          {meta}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  const theme = useTheme();

  return (
    <View
      style={[
        stateStyles.card,
        {
          backgroundColor: theme.colors.panel,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Text
        selectable
        style={[stateStyles.title, { color: theme.colors.text }]}
      >
        {title}
      </Text>
      <Text
        selectable
        style={[stateStyles.body, { color: theme.colors.muted }]}
      >
        {body}
      </Text>
    </View>
  );
}

export function StatusCard({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        stateStyles.card,
        {
          backgroundColor: theme.colors.dangerBg,
          borderColor: theme.colors.dangerBorder,
        },
      ]}
    >
      <Text
        selectable
        style={[stateStyles.title, { color: theme.colors.dangerText }]}
      >
        {title}
      </Text>
      <Text
        selectable
        style={[stateStyles.body, { color: theme.colors.dangerMuted }]}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Text
          style={[stateStyles.action, { color: theme.colors.accentSoft }]}
          onPress={onAction}
        >
          {actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

const screenHeaderStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    minHeight: 44,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: 0,
  },
  action: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "700",
  },
  trashBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  trashGlass: {
    width: 36,
    height: 36,
    borderRadius: 10,
    overflow: "hidden",
  },
  accountBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
  },
  accountBtnLarge: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  accountGradient: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  accountInitials: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: "#FFFFFF",
  },
  accountInitialsLarge: {
    fontSize: 18,
    fontWeight: "800",
  },
});

const sectionHeaderStyles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: 0,
  },
  meta: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
});

const stateStyles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 7,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  action: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    paddingTop: 4,
  },
});
