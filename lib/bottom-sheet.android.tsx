import GorhomBottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
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

  // Sync open/close with isPresented
  useEffect(() => {
    if (isPresented) {
      ref.current?.expand();
    } else {
      ref.current?.close();
    }
  }, [isPresented]);

  const snapPoints = useMemo(
    () => (fitToContents ? undefined : ['50%', '92%']),
    [fitToContents]
  );

  const renderBackdrop = useCallback(
    (props: Parameters<typeof BottomSheetBackdrop>[0]) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        pressBehavior="close"
      />
    ),
    []
  );

  return (
    <GorhomBottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={fitToContents}
      enablePanDownToClose
      onClose={onDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.colors.panel }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.border }}
      keyboardBehavior="interactive"
      android_keyboardInputMode="adjustResize"
    >
      {fitToContents ? (
        <>{children}</>
      ) : (
        <BottomSheetScrollView>{children}</BottomSheetScrollView>
      )}
    </GorhomBottomSheet>
  );
}
