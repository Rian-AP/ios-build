// On iOS we use @expo/ui/swift-ui Menu + Button for native dropdown selectors.
// The old stub returned null — this renders a real native SwiftUI Menu.
import { Host, Menu, Button } from '@expo/ui/swift-ui';
import { labelStyle } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

type PickerValue = string | number;

type PickerProps = {
  children?: ReactNode;
  selectedValue?: PickerValue | null;
  onValueChange?: (value: PickerValue, index: number) => void;
  style?: StyleProp<ViewStyle>;
  /** Label shown on the trigger button */
  label?: string;
};

type PickerItemProps = {
  label: string;
  value: PickerValue;
  color?: string;
};

type PickerComponent = ((props: PickerProps) => ReactNode) & {
  Item: (props: PickerItemProps) => ReactNode;
};

// Item is a data-only marker — rendered by the parent Picker
const PickerItem = (_props: PickerItemProps): ReactNode => null;

function PickerBase({ children, selectedValue, onValueChange, label, style }: PickerProps): ReactNode {
  // Collect PickerItem children
  const items: PickerItemProps[] = [];
  const collectItems = (nodes: ReactNode) => {
    if (!nodes) return;
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    for (const node of arr) {
      if (!node || typeof node !== 'object') continue;
      const el = node as React.ReactElement<PickerItemProps>;
      if (el.props && 'value' in el.props && 'label' in el.props) {
        items.push({ label: el.props.label, value: el.props.value });
      }
      if (el.props?.children) {
        collectItems(el.props.children as ReactNode);
      }
    }
  };
  collectItems(children);

  const selectedItem = items.find((item) => item.value === selectedValue);
  const triggerLabel = selectedItem?.label ?? label ?? String(selectedValue ?? '—');

  return (
    <View style={style}>
      <Host matchContents>
        <Menu
          label={triggerLabel}
          systemImage="chevron.up.chevron.down"
          modifiers={[labelStyle('titleAndIcon')]}
        >
          {items.map((item, index) => (
            <Button
              key={String(item.value)}
              label={item.label}
              systemImage={item.value === selectedValue ? 'checkmark' : undefined}
              onPress={() => onValueChange?.(item.value, index)}
            />
          ))}
        </Menu>
      </Host>
    </View>
  );
}

export const Picker = PickerBase as PickerComponent;
Picker.Item = PickerItem;
