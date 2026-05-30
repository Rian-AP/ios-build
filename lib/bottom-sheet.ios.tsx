// iOS: use @gorhom/bottom-sheet for native feel (drag, snap, backdrop).
// The @expo/ui SwiftUI BottomSheet only accepts SwiftUI children,
// so it can't host React Native content like ScrollView/Pressable.
import GorhomBottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
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
  const ref = useRef<GorhomBottomSheet>(null);

  // Snap points: fitToContents uses dynamic height, otherwise 50% and 92%
  const snapPoints = useMemo(
    () => (fitToContents ? undefined : ['50%', '92%']),
    [fitToContents],
  );

  // Sync open/close with isPresented
  useEffect(() => {
    if (isPresented) {
      ref.current?.expand();
    } else {
      ref.current?.close();
    }
  }, [isPresented]);

  const renderBackdrop = useCallback(
    (props: Parameters<typeof BottomSheetBackdrop>[0]) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.45}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) {
        onDismiss();
      }
    },
    [onDismiss],
  );

  return (
    <GorhomBottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={fitToContents}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleSheetChanges}
      backgroundStyle={[
        styles.background,
        { backgroundColor: theme.colors.panel },
      ]}
      handleIndicatorStyle={[
        styles.handle,
        { backgroundColor: theme.colors.border },
      ]}
    >
      {fitToContents ? (
        <BottomSheetView style={styles.fitView}>
          {children}
        </BottomSheetView>
      ) : (
        <BottomSheetScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </BottomSheetScrollView>
      )}
    </GorhomBottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  fitView: {
    paddingBottom: 16,
  },
});
