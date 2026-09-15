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

export function splitWorkspaceElement(_root: WorkspaceElement, _target: WorkspaceElement, _newEl: WorkspaceElement, direction: WorkspaceDivider['direction'], before: boolean): WorkspaceElement {
	const root = deepClone(_root);
	const target = deepClone(_target);
	const newEl = deepClone(_newEl);
	const parent = findWorkspaceParent(root, target.id);
	if (parent == null) throw new Error('Parent not found');
	const index = parent.children.findIndex(child => child.element.id === target.id);
	parent.children[index].element = {
		id: genId(),
		type: 'divider',
		direction,
		children: before ? [{ ratio: 0.5, element: newEl }, { ratio: 0.5, element: target }] : [{ ratio: 0.5, element: target }, { ratio: 0.5, element: newEl }],
	};
	return root;
}

/*
 * 子が1つしかないdividerがあれば、そのdividerを削除して子を上の階層に引き上げる処理や、dividerの直下の子に同じdirectionのdividerが含まれる場合はその子を削除して孫を自身の子に引き上げる
 * 引き上げる場合、表示したときの視覚的な比率は引き上げ前を保つようにする(内部的なratioプロパティを調整する)
 */
export function cleanupWorkspaceDefinition(_root: WorkspaceElement): WorkspaceElement {
	const root = deepClone(_root);
	// TODO
	return root;
}

export function removeWorkspaceElement(_root: WorkspaceElement, _target: WorkspaceElement) {
	const root = deepClone(_root);
	const target = deepClone(_target);
	// TODO
	return cleanupWorkspaceDefinition(root);
}

export function splitAndAddWorkspacePanel(_root: WorkspaceElement, _target: WorkspaceElement, position: 'below' | 'above' | 'left' | 'right') {
	const root = deepClone(_root);
	const parent = findWorkspaceParent(root, _target.id);
	if (!parent) return;

	const direction = position === 'below' || position === 'above' ? 'vertical' : 'horizontal';
	const before = position === 'above' || position === 'left';
	const panel: WorkspacePanel = { id: genId(), type: 'panel', contentType: 'empty' };
	return cleanupWorkspaceDefinition(splitWorkspaceElement(parent, _target, panel, direction, before));
}
