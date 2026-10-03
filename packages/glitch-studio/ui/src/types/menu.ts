import type { Component, ComputedRef, Ref, MaybeRef } from 'vue';
import type { ComponentProps as CP } from 'vue-component-type-helpers';
import type { OptionValue } from '@/types/option-value.ts';

type ComponentProps<T extends Component> = { [K in keyof CP<T>]: MaybeRef<CP<T>[K]> };

type Text = string | ComputedRef<string>;

export type MenuAction = (ev: PointerEvent) => void;

export interface MenuButton {
	type?: 'button';
	text: Text;
	caption?: Text | null | undefined | ComputedRef<null | undefined>;
	icon?: string;
	indicate?: boolean;
	danger?: boolean;
	active?: boolean | ComputedRef<boolean>;
	action: MenuAction;
}

interface MenuBase {
	type: string;
}

interface TextMenuBase extends MenuBase {
	text: Text;
	caption?: Text | null | undefined | ComputedRef<null | undefined>;
	icon?: string;
}

export interface MenuDivider extends MenuBase {
	type: 'divider';
}

export interface MenuLabel extends MenuBase {
	type: 'label';
	text: Text;
	caption?: Text | null | undefined | ComputedRef<null | undefined>;
}

export interface MenuA extends TextMenuBase {
	type: 'a';
	href: string;
	target?: string;
	download?: string;
	indicate?: boolean;
}

export interface MenuSwitch extends TextMenuBase {
	type: 'switch';
	ref: Ref<boolean>;
	disabled?: boolean | Ref<boolean>;
}

export interface MenuRadio extends TextMenuBase {
	type: 'radio';
	ref: Ref<OptionValue>;
	options: ({
		type?: 'option';
		label: string;
		value: OptionValue;
	} | MenuDivider)[];
	disabled?: boolean | Ref<boolean>;
}

export interface MenuRadioOption extends MenuBase {
	type: 'radioOption';
	text: Text;
	caption?: Text | null | undefined | ComputedRef<null | undefined>;
	action: MenuAction;
	active?: boolean | ComputedRef<boolean>;
}

export interface MenuComponent<T extends Component = any> extends MenuBase {
	type: 'component';
	component: T;
	props?: ComponentProps<T>;
}

export interface MenuParent extends TextMenuBase {
	type: 'parent';
	children: MenuItem[] | (() => Promise<MenuItem[]> | MenuItem[]);
}

export interface MenuPending extends MenuBase {
	type: 'pending';
}

type OuterMenuItem = MenuDivider | MenuLabel | MenuA | MenuSwitch | MenuButton | MenuRadio | MenuRadioOption | MenuComponent | MenuParent;
type OuterPromiseMenuItem = Promise<MenuLabel | MenuA | MenuSwitch | MenuButton | MenuComponent | MenuParent>;
export type MenuItem = OuterMenuItem | OuterPromiseMenuItem;
export type InnerMenuItem = MenuDivider | MenuPending | MenuLabel | MenuA | MenuSwitch | MenuButton | MenuRadio | MenuRadioOption | MenuComponent | MenuParent;
