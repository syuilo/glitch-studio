// NOTE: このファイルはpreferencesへの参照・知識を持っていてはならない
// また、引数をmutateしてはならない

import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { genId } from '@glitch/shared/utility/id.js';
import type { WorkspaceElement, WorkspaceDivider, WorkspaceTabs, WorkspacePanel } from '@/workspace.ts';

export function findWorkspaceParent(root: WorkspaceElement, id: string): WorkspaceDivider | WorkspaceTabs | null {
	if (root.type === 'tabs' || root.type === 'divider') {
		for (const child of root.children) {
			if (child.element.id === id) return root;
			const parent = findWorkspaceParent(child.element, id);
			if (parent != null) return parent;
		}
	}
	return null;
}

export function findWorkspaceElement(root: WorkspaceElement, id: string): WorkspaceElement | null {
	if (root.id === id) return root;
	return findWorkspaceParent(root, id)?.children.find(child => child.element.id === id)?.element ?? null;
}

export function replaceWorkspaceElement(_root: WorkspaceElement, id: string, element: WorkspaceElement): WorkspaceElement {
	if (_root.id === id) return deepClone(element);
	const root = deepClone(_root);
	const child = findWorkspaceParent(root, id)?.children.find(child => child.element.id === id);
	if (child) child.element = deepClone(element);
	return root;
}

export function splitWorkspaceElement(_root: WorkspaceElement, _target: WorkspaceElement, _newEl: WorkspaceElement, direction: WorkspaceDivider['direction'], before: boolean): WorkspaceElement {
	const target = findWorkspaceElement(_root, _target.id);
	if (!target) return deepClone(_root);
	const newEl = _newEl;
	return replaceWorkspaceElement(_root, target.id, {
		id: genId(),
		type: 'divider',
		direction,
		children: before ? [{ ratio: 0.5, element: newEl }, { ratio: 0.5, element: target }] : [{ ratio: 0.5, element: target }, { ratio: 0.5, element: newEl }],
	});
}

/*
 * 子が1つしかないdividerがあれば、そのdividerを削除して子を上の階層に引き上げる処理や、dividerの直下の子に同じdirectionのdividerが含まれる場合はその子を削除して孫を自身の子に引き上げる
 * 引き上げる場合、表示したときの視覚的な比率は引き上げ前を保つようにする(内部的なratioプロパティを調整する)
 */
export function cleanupWorkspaceDefinition(_root: WorkspaceElement): WorkspaceElement {
	function cleanup(element: WorkspaceElement): WorkspaceElement | null {
		if (element.type === 'panel') return element;
		for (let i = element.children.length - 1; i >= 0; i--) {
			const child = cleanup(element.children[i].element);
			if (child) element.children[i].element = child;
			else element.children.splice(i, 1);
		}
		if (element.children.length === 0) return null;
		// タブは1つでも追加操作の入口を残すため、dividerだけを畳む。
		if (element.type === 'tabs') return element;
		if (element.children.length === 1) return element.children[0].element;
		element.children = element.children.flatMap(child => {
			const nested = child.element;
			if (nested.type !== 'divider' || nested.direction !== element.direction) return [child];
			const totalRatio = nested.children.reduce((sum, grandchild) => sum + grandchild.ratio, 0);
			return nested.children.map(grandchild => ({
				// 孫の比率を親が占めていた領域へ換算して、見た目の比率を保つ。
				ratio: child.ratio * grandchild.ratio / totalRatio,
				element: grandchild.element,
			}));
		});
		return element;
	}

	return cleanup(deepClone(_root)) ?? { id: genId(), type: 'panel', contentType: 'blank' };
}

export function removeWorkspaceElement(_root: WorkspaceElement, _target: WorkspaceElement): WorkspaceElement {
	if (_root.id === _target.id) return { id: genId(), type: 'panel', contentType: 'blank' };
	const root = deepClone(_root);
	const parent = findWorkspaceParent(root, _target.id);
	if (parent) {
		const index = parent.children.findIndex(child => child.element.id === _target.id);
		parent.children.splice(index, 1);
	}
	return cleanupWorkspaceDefinition(root);
}

export function splitAndAddWorkspacePanel(_root: WorkspaceElement, _target: WorkspaceElement, position: 'below' | 'above' | 'left' | 'right') {
	const direction = position === 'below' || position === 'above' ? 'vertical' : 'horizontal';
	const before = position === 'above' || position === 'left';
	const panel: WorkspacePanel = { id: genId(), type: 'panel', contentType: 'blank' };
	return cleanupWorkspaceDefinition(splitWorkspaceElement(_root, _target, panel, direction, before));
}
