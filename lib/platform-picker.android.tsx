import { Picker as RNPicker } from '@react-native-picker/picker';
import type { ComponentProps } from 'react';

type RNPickerProps = ComponentProps<typeof RNPicker>;

// On Android the native Picker needs mode="dropdown" to render correctly.
// overflow:hidden on the wrapper clips the native view, so we set
// backgroundColor on the Picker itself instead.
const AndroidPicker = ({ style, ...props }: RNPickerProps) => (
  <RNPicker mode="dropdown" style={[{ width: '100%' }, style]} {...props} />
);

AndroidPicker.Item = RNPicker.Item;

export { AndroidPicker as Picker };

