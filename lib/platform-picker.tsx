import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type PickerValue = string | number;

type PickerProps = {
  children?: ReactNode;
  selectedValue?: PickerValue | null;
  onValueChange?: (value: PickerValue, index: number) => void;
  style?: StyleProp<ViewStyle>;
};

type PickerItemProps = {
  label: string;
  value: PickerValue;
  color?: string;
};

type PickerComponent = ((props: PickerProps) => ReactNode) & {
  Item: (props: PickerItemProps) => ReactNode;
};

const PickerItem = (_props: PickerItemProps) => null;
const PickerBase = (_props: PickerProps) => null;

export const Picker = PickerBase as PickerComponent;
Picker.Item = PickerItem;

