// @expo/ui SwiftUI BottomSheet crashes on iOS 26 with Fabric
// (_isAncestorOfFirstResponder unrecognized selector).
// Use the cross-platform Animated/Modal implementation instead.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '@/lib/theme';

export type AppBottomSheetProps = {
  isPresented: boolean;
  onDismiss: () => void;
  children?: ReactNode;
  fitToContents?: boolean;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const ANIMATION_DURATION = 280;

export function AppBottomSheet({
  isPresented,
  onDismiss,
  children,
  fitToContents = false,
}: AppBottomSheetProps) {
  const theme = useTheme();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isPresented) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: ANIMATION_DURATION,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isPresented, translateY, backdropOpacity]);

  return (
    <Modal
      visible={isPresented}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.colors.panel },
          fitToContents ? styles.sheetFitContent : styles.sheetHalf,
          { transform: [{ translateY }] },
        ]}
      >
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
        </View>

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
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  sheetHalf: {
    maxHeight: '92%',
  },
  sheetFitContent: {},
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
});
