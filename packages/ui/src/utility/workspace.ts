import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import type { WorkspaceDivider, WorkspacePanel } from '@/types/workspace.ts';

export function findWorkspaceParent(divider: WorkspaceDivider, id: string): WorkspaceDivider | undefined {
	for (const child of divider.children) {
		if (child.id === id) return divider;
		if (child.type === null) {
			const parent = findWorkspaceParent(child, id);
			if (parent) return parent;
		}
	}
}

export function splitWorkspacePanel(parent: WorkspaceDivider, target: WorkspacePanel, panel: WorkspacePanel, direction: WorkspaceDivider['direction'], before: boolean) {
	const index = parent.children.findIndex(child => child.id === target.id);
	const ratio = target.ratio;
	target.ratio = panel.ratio = 1;
	parent.children.splice(index, 1, {
		id: genId(),
		type: null,
		ratio,
		direction,
		children: before ? [panel, target] : [target, panel],
	});
}

export function cleanupWorkspaceDefinition(_divider: WorkspaceDivider): WorkspaceDivider {
	const divider = deepClone(_divider);
	divider.children = divider.children.flatMap((child): WorkspaceDivider['children'] => {
		if (child.type !== null) return [child];
		cleanupWorkspaceDefinition(child);
		if (child.children.length === 0) return [];
		if (child.children.length !== 1 && child.direction !== divider.direction) return [child];

		// 親の中で占めていた比率を、子同士の比率に応じて配分する。
		const totalRatio = child.children.reduce((total, grandchild) => total + grandchild.ratio, 0);
		for (const grandchild of child.children) {
			grandchild.ratio = child.ratio * grandchild.ratio / totalRatio;
		}
		return child.children;
	});

	// ルートは常にdividerとして扱うため、唯一の子がdividerならその内容を引き継ぐ。
	const onlyChild = divider.children[0];
	if (divider.children.length === 1 && onlyChild.type === null) {
		divider.direction = onlyChild.direction;
		divider.children = onlyChild.children;
	}
	return divider;
}
