// Use the same cross-platform implementation — @expo/ui SwiftUI BottomSheet
// crashes on iOS 26 with Fabric (unrecognized selector _isAncestorOfFirstResponder).
// Fall back to the Animated modal-based sheet which works on all iOS versions.
export { AppBottomSheet, type AppBottomSheetProps } from './bottom-sheet';
