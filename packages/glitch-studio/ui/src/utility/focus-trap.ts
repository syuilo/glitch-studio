import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.ts';

// 描画側が持つz-indexを登録し、inertの変更後にgetComputedStyleでスタイル再計算を強制しない。
const focusTrapElements = new Map<HTMLElement, number>();
const ignoreElements = [
	'script',
	'style',
];

function containsFocusTrappedElements(el: HTMLElement): boolean {
	for (const focusTrapElement of focusTrapElements.keys()) {
		if (el.contains(focusTrapElement)) return true;
	}
	return false;
}

function getHighestZIndexElement(): { el: HTMLElement; zIndex: number; } | null {
	let highestZIndexElement: HTMLElement | null = null;
	let highestZIndex = -Infinity;

	focusTrapElements.forEach((zIndex, el) => {
		if (zIndex > highestZIndex) {
			highestZIndex = zIndex;
			highestZIndexElement = el;
		}
	});

	return highestZIndexElement == null ? null : {
		el: highestZIndexElement,
		zIndex: highestZIndex,
	};
}

function restoreFocusTrap(el: HTMLElement, highestZIndexElement: HTMLElement | null): void {
	if (el.inert === true) {
		el.inert = false;
	}

	if (el.parentElement != null && el !== window.document.body) {
		el.parentElement.childNodes.forEach((siblingNode) => {
			const siblingEl = getHTMLElementOrNull(siblingNode);
			if (siblingEl == null) return;
			if (
				siblingEl !== el &&
				(
					highestZIndexElement == null ||
					siblingEl === highestZIndexElement ||
					siblingEl.contains(highestZIndexElement)
				)
			) {
				siblingEl.inert = false;
			} else if (
				highestZIndexElement != null &&
				siblingEl !== highestZIndexElement &&
				!siblingEl.contains(highestZIndexElement) &&
				!ignoreElements.includes(siblingEl.tagName.toLowerCase())
			) {
				siblingEl.inert = true;
			} else {
				siblingEl.inert = false;
			}
		});
		restoreFocusTrap(el.parentElement, highestZIndexElement);
	}
}

function applyFocusTrap(el: HTMLElement, hasInteractionWithOtherFocusTrappedEls: boolean): void {
	if (el.inert === true) {
		el.inert = false;
	}

	if (el.parentElement != null && el !== window.document.body) {
		el.parentElement.childNodes.forEach((siblingNode) => {
			const siblingEl = getHTMLElementOrNull(siblingNode);
			if (siblingEl == null) return;
			if (
				siblingEl !== el &&
				(
					hasInteractionWithOtherFocusTrappedEls === false ||
					(!focusTrapElements.has(siblingEl) && !containsFocusTrappedElements(siblingEl))
				) &&
				!ignoreElements.includes(siblingEl.tagName.toLowerCase())
			) {
				siblingEl.inert = true;
			}
		});
		applyFocusTrap(el.parentElement, hasInteractionWithOtherFocusTrappedEls);
	}
}

export function focusTrap(el: HTMLElement, options: {
	zIndex: number;
	hasInteractionWithOtherFocusTrappedEls?: boolean;
}): { release: () => void; } {
	const highestZIndexElement = getHighestZIndexElement();
	focusTrapElements.set(el, options.zIndex);

	// 背後の要素が後から開かれても最前面の制御を維持し、同じz-indexなら今回の要素を優先する。
	const activeElement = highestZIndexElement != null && options.zIndex < highestZIndexElement.zIndex
		? highestZIndexElement.el
		: el;
	applyFocusTrap(activeElement, options.hasInteractionWithOtherFocusTrappedEls ?? false);

	return {
		release: () => {
			focusTrapElements.delete(el);
			// 登録の解除と祖先の復元を分け、解除後の最前面を一度だけ選んでinertを復元する。
			restoreFocusTrap(el, getHighestZIndexElement()?.el ?? null);
		},
	};
}
