import { BottomSheet, Group } from '@expo/ui/swift-ui';
import {
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

export type AppBottomSheetProps = {
  isPresented: boolean;
  onDismiss: () => void;
  children?: ReactNode;
  fitToContents?: boolean;
};

export function AppBottomSheet({
  isPresented,
  onDismiss,
  children,
  fitToContents = false,
}: AppBottomSheetProps) {
  const theme = useTheme();

  return (
    <BottomSheet
      isPresented={isPresented}
      onIsPresentedChange={(presented) => {
        if (!presented) onDismiss();
      }}
      fitToContents={fitToContents}
    >
      <Group
        modifiers={[
          presentationDragIndicator('visible'),
          ...(fitToContents ? [] : [presentationDetents(['medium', 'large'])]),
        ]}
      >
        <SafeAreaView
          style={{
            flex: fitToContents ? undefined : 1,
            backgroundColor: theme.colors.panel,
          }}
          edges={['bottom']}
        >
          {fitToContents ? (
            <View>{children}</View>
          ) : (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          )}
        </SafeAreaView>
      </Group>
    </BottomSheet>
  );
}
