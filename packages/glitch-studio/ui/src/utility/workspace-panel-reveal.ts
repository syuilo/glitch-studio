import type { WorkspaceElement, WorkspacePanel, WorkspaceTabs } from '@/workspace.ts';

export type WorkspacePanelRevealRequest = {
	contentType: WorkspacePanel['contentType'];
	sourcePanelId: string;
};

export type WorkspacePanelRevealPlan = {
	panelId: string;
	tabSelections: { tabsId: string; childId: string }[];
	expandIds: string[];
};

export function getWorkspaceSelectedTabId(tabs: WorkspaceTabs, selections: ReadonlyMap<string, string>): string | undefined {
	const selected = selections.get(tabs.id);
	return tabs.children.find(child => child.element.id === selected)?.element.id ?? tabs.children[0]?.element.id;
}

export function getWorkspacePanelRevealCost(plan: WorkspacePanelRevealPlan): number {
	return plan.tabSelections.length + plan.expandIds.length;
}

/** DOMの有無によらず、未マウントのタブも含めて表示に必要な変更を調べる。 */
export function findWorkspacePanelRevealPlan(root: WorkspaceElement, selections: ReadonlyMap<string, string>, request: WorkspacePanelRevealRequest): WorkspacePanelRevealPlan | null {
	const panels: { panel: WorkspacePanel; tabs: Map<string, string>; expandIds: string[] }[] = [];

	function visit(element: WorkspaceElement, parent: WorkspaceElement | null, tabs: Map<string, string>, expandIds: string[]) {
		const expanded = parent?.type === 'divider' && element.type !== 'divider' && element.collapsed
			? [...expandIds, element.id] : expandIds;
		if (element.type === 'panel') {
			panels.push({ panel: element, tabs, expandIds: expanded });
		} else {
			for (const child of element.children) {
				visit(child.element, element, element.type === 'tabs' ? new Map([...tabs, [element.id, child.element.id]]) : tabs, expanded);
			}
		}
	}

	visit(root, null, new Map(), []);
	const source = panels.find(entry => entry.panel.id === request.sourcePanelId);
	if (!source) return null;
	const selectedIds = new Map<string, string | undefined>();

	function collectSelections(element: WorkspaceElement) {
		if (element.type === 'panel') return;
		if (element.type === 'tabs') selectedIds.set(element.id, getWorkspaceSelectedTabId(element, selections));
		for (const child of element.children) collectSelections(child.element);
	}

	collectSelections(root);
	let best: WorkspacePanelRevealPlan | null = null;
	for (const entry of panels) {
		if (entry.panel.contentType !== request.contentType) continue;
		// 共通の祖先タブで別の枝を選ぶと、操作元そのものがアンマウントされる。
		// 直近の親だけの判定では、入れ子になったworkspaceでこれを防げない。
		if ([...source.tabs].some(([id, child]) => entry.tabs.has(id) && entry.tabs.get(id) !== child)) continue;
		const plan: WorkspacePanelRevealPlan = {
			panelId: entry.panel.id,
			tabSelections: [...entry.tabs].filter(([id, child]) => selectedIds.get(id) !== child).map(([tabsId, childId]) => ({ tabsId, childId })),
			expandIds: entry.expandIds,
		};
		// 変更不要の表示中パネルが最優先。同点では先に見つけたツリー順を保つ。
		if (!best || getWorkspacePanelRevealCost(plan) < getWorkspacePanelRevealCost(best)) best = plan;
	}
	return best;
}
