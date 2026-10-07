import { reactive, shallowReactive, watch } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import type { WorkspaceElement, WorkspaceTabs } from '@/workspace.ts';
import type { WorkspacePanelRevealRequest } from '@/utility/workspace-panel-reveal.ts';
import { findWorkspacePanelRevealPlan, getWorkspacePanelRevealCost, getWorkspaceSelectedTabId } from '@/utility/workspace-panel-reveal.ts';
import { findWorkspaceElement } from '@/utility/workspace.ts';

export const workspaceControllerKey: InjectionKey<WorkspaceController> = Symbol('workspaceController');

export class WorkspaceController {
	private readonly selectedTabIds = reactive(new Map<string, string>());
	// HTMLElementはVueのproxyにせず、マウント・アンマウントだけを購読する。
	readonly panelTargets = shallowReactive(new Map<string, HTMLElement>());

	constructor(private readonly root: Ref<WorkspaceElement>, private readonly commit: (root: WorkspaceElement) => void) {
		// タブがアンマウントされても選択を維持し、構造変更時には旧選択と同じ位置へ戻す。
		// 削除済みIDを残さないため、非表示部分も含むツリー全体をここで管理する。
		watch(root, (value, oldValue) => {
			const retained = new Set<string>();
			const visit = (element: WorkspaceElement) => {
				if (element.type === 'panel') return;
				if (element.type === 'tabs') {
					retained.add(element.id);
					const selected = this.selectedTabIds.get(element.id);
					if (!element.children.some(child => child.element.id === selected)) {
						const old = oldValue ? findWorkspaceElement(oldValue, element.id) : null;
						const index = old?.type === 'tabs' ? Math.max(0, old.children.findIndex(child => child.element.id === selected)) : 0;
						const child = element.children[Math.min(index, element.children.length - 1)];
						if (child) this.selectedTabIds.set(element.id, child.element.id);
						else this.selectedTabIds.delete(element.id);
					}
				}
				for (const child of element.children) visit(child.element);
			};
			visit(value);
			for (const id of this.selectedTabIds.keys()) if (!retained.has(id)) this.selectedTabIds.delete(id);
		}, { immediate: true, flush: 'sync' });
	}

	getSelectedTabId(tabs: WorkspaceTabs) {
		return getWorkspaceSelectedTabId(tabs, this.selectedTabIds);
	}

	selectTab(tabsId: string, childId: string) {
		const tabs = findWorkspaceElement(this.root.value, tabsId);
		if (tabs?.type === 'tabs' && tabs.children.some(child => child.element.id === childId)) this.selectedTabIds.set(tabsId, childId);
	}

	findVisiblePanel(request: WorkspacePanelRevealRequest): string | null {
		const plan = findWorkspacePanelRevealPlan(this.root.value, this.selectedTabIds, request);
		return plan && getWorkspacePanelRevealCost(plan) === 0 ? plan.panelId : null;
	}

	revealPanel(request: WorkspacePanelRevealRequest): string | null {
		const plan = findWorkspacePanelRevealPlan(this.root.value, this.selectedTabIds, request);
		if (!plan) return null;
		if (plan.expandIds.length) {
			const root = deepClone(this.root.value);
			for (const id of plan.expandIds) {
				const element = findWorkspaceElement(root, id);
				if (element && element.type !== 'divider') element.collapsed = false;
			}
			this.commit(root);
		}
		for (const { tabsId, childId } of plan.tabSelections) this.selectTab(tabsId, childId);
		return plan.panelId;
	}
}
