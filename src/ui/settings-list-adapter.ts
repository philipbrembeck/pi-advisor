import {
  type Component,
  type Focusable,
  type Input,
  Key,
  matchesKey,
  type SettingItem,
  type SettingsList,
} from "@earendil-works/pi-tui";

interface SettingsListPrivateFields {
  filteredItems: SettingItem[];
  searchInput?: Input;
  selectedIndex: number;
  submenuComponent?: Component | null;
}

/**
 * Contains the narrow compatibility access needed for pi-tui's SettingsList.
 * No other UI module should depend on its private fields.
 */
export class SettingsListAdapter {
  private readonly list: SettingsList;

  constructor(list: SettingsList) {
    this.list = list;
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return this.list.render(width);
  }

  handleInput(keyData: string): void {
    this.list.handleInput(keyData);
  }

  /** Compatibility-only view for existing component integration seams. */
  get submenuComponent(): Component | null | undefined {
    return this.privateFields().submenuComponent;
  }

  setFocused(value: boolean): void {
    const fields = this.privateFields();
    const submenu = fields.submenuComponent as Focusable | undefined;
    if (submenu) {
      submenu.focused = value;
    }
  }

  setSelectedId(items: SettingItem[], selectedId: string): void {
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    if (selectedIndex >= 0) {
      this.privateFields().selectedIndex = selectedIndex;
    }
  }

  changeWithArrow(
    keyData: string,
    onChange: (id: string, value: string) => void
  ): boolean {
    let direction = 0;
    if (matchesKey(keyData, Key.left) || keyData === "\u001b[D") {
      direction = -1;
    } else if (matchesKey(keyData, Key.right) || keyData === "\u001b[C") {
      direction = 1;
    }
    if (direction === 0) {
      return false;
    }

    const fields = this.privateFields();
    if (fields.submenuComponent || fields.searchInput?.getValue()) {
      return false;
    }
    const item = fields.filteredItems[fields.selectedIndex];
    if (!item?.values?.length) {
      return false;
    }
    const currentIndex = item.values.indexOf(item.currentValue);
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction > 0 ? 0 : item.values.length - 1;
    } else {
      nextIndex =
        (currentIndex + direction + item.values.length) % item.values.length;
    }
    const nextValue = item.values[nextIndex];
    if (nextValue === undefined) {
      return false;
    }
    item.currentValue = nextValue;
    onChange(item.id, nextValue);
    return true;
  }

  private privateFields(): SettingsListPrivateFields {
    return this.list as unknown as SettingsListPrivateFields;
  }
}
