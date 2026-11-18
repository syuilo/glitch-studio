import { clipboardText } from './clipboard-text.ts';
import type { VisualModuleEffectNode, VisualModuleRelayNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { inputText } from '@/ui.ts';

export function getVisualModuleNodeHeaderMenuItems(
	node: VisualModuleEffectNode | VisualModuleRelayNode,
	setDisplayName: (displayName: string) => void,
): MenuItem[] {
	const items: MenuItem[] = [{
		id: 'renameNode',
		text: i18n.ts.Rename,
		icon: 'ti ti-forms',
		action: async () => {
			const { canceled, result } = await inputText({
				title: i18n.ts.Rename,
				default: node.type === 'effect' ? node.displayName : node.label ?? '',
			});
			if (!canceled) setDisplayName(result);
		},
	}, {
		id: 'copyNodeId',
		text: i18n.ts._Node.CopyNodeId,
		icon: 'ti ti-hash',
		action: () => clipboardText.writeText(node.id),
	}];
	if (node.type === 'effect') {
		items.push({
			id: 'copyEffectId',
			text: i18n.ts._Node.CopyEffectId,
			icon: 'ti ti-hash',
			action: () => clipboardText.writeText(node.effectId),
		});
	}
	return items;
}
