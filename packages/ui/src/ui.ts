import { markRaw, ref, nextTick } from 'vue';
import type { Component, MaybeRef, InjectionKey, Ref } from 'vue';
import type { ComponentEmit, ComponentProps as CP } from 'vue-component-type-helpers';
import type { MenuItem } from '@/types/menu.ts';
import type { OverloadToUnion } from '@/types/overload-to-union.ts';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.ts';
import { focusParent } from '@/utility/focus.ts';
import GsPopupMenu from '@/components/common/GsPopupMenu.vue';
import GsContextMenu from '@/components/common/GsContextMenu.vue';
import GsDialog from '@/components/common/GsDialog.vue';

export const DI = {
	currentStickyTop: Symbol() as InjectionKey<Ref<number>>,
	currentStickyBottom: Symbol() as InjectionKey<Ref<number>>,
	inModal: Symbol() as InjectionKey<boolean>,
};

let popupIdCount = 0;
export const popups = ref<{
	id: number;
	component: Component;
	props: Record<string, any>;
	events: Record<string, any>;
}[]>([]);

const zIndexes = {
	veryLow: 500000,
	low: 1000000,
	middle: 2000000,
	high: 3000000,
};
export function claimZIndex(priority: keyof typeof zIndexes = 'low'): number {
	zIndexes[priority] += 100;
	return zIndexes[priority];
}

// props に ref を許可するようにする
type PropsWithRefs<P> = { [K in keyof P]: MaybeRef<P[K]> };
type ComponentProps<T extends Component> = PropsWithRefs<CP<T>>;

// 関数の引数が any[] (もっとも広義なもの) かどうかを判定し、any[] の場合は排除 (never) するヘルパー
type FilterSpecificFunc<T> = T extends (...args: any[]) => void
	? (any[] extends Parameters<T> ? never : T)
	: T;

// オブジェクトの各プロパティに対して再帰的、あるいは単純に適用する型関数
type CleanFunctions<T> = {
	[K in keyof T]: T[K] extends (...args: any[]) => any
		? FilterSpecificFunc<T[K]>
		: T[K];
};

// emitの関数群をオブジェクト型に変換する（InstanceType<Component>['$emit']はFunctionalComponent = ジェネリックコンポーネントでは使用できない）
type ComponentEmitsObject<C extends Component, IE = OverloadToUnion<ComponentEmit<C>>> = CleanFunctions<{
	[K in IE extends (evName: infer U, ...args: any[]) => any ? U & PropertyKey : never]: IE extends (evName: K, ...args: infer A) => infer R
		? (...args: A) => R
		: (...args: any[]) => void;
}>;

// NOTE: ジェネリック型つきのコンポーネントでは、emitsの型推論がうまく働かない（型変数を取り出すことはできないため）
// NOTE: emitsがOverloadToUnionで対応しているオーバーロードの数を超える場合は、OverloadToUnionの個数を増やせばOK
export function popup<T extends Component>(
	component: T,
	props: ComponentProps<T>,
	events: Partial<ComponentEmitsObject<T>> = {},
): { dispose: () => void } {
	markRaw(component);

	const id = ++popupIdCount;
	const dispose = () => {
		nextTick(() => {
			popups.value = popups.value.filter(p => p.id !== id);
		});
	};
	const state = {
		component,
		props,
		events,
		id,
	};

	popups.value.push(state);

	return {
		dispose,
	};
}

/*
export async function popupAsyncWithDialog<T extends Component>(
	componentFetching: Promise<T>,
	props: ComponentProps<T>,
	events: Partial<ComponentEmitsObject<T>> = {},
): Promise<{ dispose: () => void }> {
	let component: T;
	let closeWaiting = () => { };

	const timer = window.setTimeout(() => {
		closeWaiting = waiting();
	}, 100); // コンポーネントがキャッシュされている場合にもwaitingが表示されて画面がちらつくのを防止するためにラグを追加

	try {
		component = await componentFetching;
	} catch (err) {
		window.clearTimeout(timer);
		closeWaiting();
		alert({
			type: 'error',
			title: i18n.ts.somethingHappened,
			text: 'CODE: ASYNC_COMP_LOAD_FAIL',
		});
		throw err;
	}

	window.clearTimeout(timer);
	closeWaiting();

	return popup(component, props, events);
}
*/

export function popupMenu(items: (MenuItem | null)[], anchorElement?: HTMLElement | EventTarget | null, options?: {
	align?: string;
	width?: number;
	onClosing?: () => void;
	onClosed?: () => void;
	debugDisablePredictionCone?: boolean;
	debugShowPredictionCone?: boolean;
	abortSignal?: AbortSignal;
}): Promise<void> {
	if (!(anchorElement instanceof HTMLElement)) {
		anchorElement = null;
	}

	let returnFocusTo = getHTMLElementOrNull(anchorElement) ?? getHTMLElementOrNull(window.document.activeElement);
	return new Promise(resolve => nextTick(() => {
		if (options?.abortSignal?.aborted) {
			resolve();
			return;
		}
		const { dispose } = popup(GsPopupMenu, {
			items: items.filter(x => x != null),
			anchorElement,
			width: options?.width,
			align: options?.align,
			returnFocusTo,
			debugDisablePredictionCone: options?.debugDisablePredictionCone,
			debugShowPredictionCone: options?.debugShowPredictionCone,
		}, {
			closed: () => {
				resolve();
				dispose();
				returnFocusTo = null;
				options?.onClosed?.();
			},
			closing: () => {
				options?.onClosing?.();
			},
		});
		if (options?.abortSignal) {
			options.abortSignal.addEventListener('abort', () => {
				// TODO
			}, { once: true });
		}
	}));
}

export function contextMenu(items: MenuItem[], ev: PointerEvent): Promise<void> {
	let returnFocusTo = getHTMLElementOrNull(ev.currentTarget ?? ev.target) ?? getHTMLElementOrNull(window.document.activeElement);
	ev.preventDefault();
	return new Promise(resolve => nextTick(() => {
		const { dispose } = popup(GsContextMenu, {
			items,
			ev,
		}, {
			closed: () => {
				resolve();
				dispose();

				// GsModalを通していないのでここでフォーカスを戻す処理を行う
				if (returnFocusTo != null) {
					focusParent(returnFocusTo, true, false);
					returnFocusTo = null;
				}
			},
		});
	}));
}

export function alert(props: {
	type?: 'error' | 'info' | 'success' | 'warning' | 'waiting' | 'question';
	title?: string;
	text?: string;
}): Promise<void> {
	return new Promise(resolve => {
		const { dispose } = popup(GsDialog, props, {
			done: () => {
				resolve();
			},
			closed: () => dispose(),
		});
	});
}

export function confirm(props: {
	type: 'error' | 'info' | 'success' | 'warning' | 'waiting' | 'question';
	title?: string;
	text?: string;
	okText?: string;
	cancelText?: string;
}): Promise<{ canceled: boolean }> {
	return new Promise(resolve => {
		const { dispose } = popup(GsDialog, {
			...props,
			showCancelButton: true,
		}, {
			done: result => {
				resolve(result ? result : { canceled: true });
			},
			closed: () => dispose(),
		});
	});
}
