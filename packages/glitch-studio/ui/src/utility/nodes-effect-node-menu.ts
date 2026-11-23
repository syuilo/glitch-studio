import { clipboardText } from './clipboard-text.ts';
import type { NodesEffectEffectNode, NodesEffectRelayNode } from '@/types/nodes-effect-view.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { inputText } from '@/ui.ts';

export function getNodesEffectNodeHeaderMenuItems(
	node: NodesEffectEffectNode | NodesEffectRelayNode,
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
	if (node.type === 'effect' && 'id' in node.effectSource) {
		const id = node.effectSource.id;
		items.push({
			id: 'copyEffectId',
			text: i18n.ts._Node.CopyEffectId,
			icon: 'ti ti-hash',
			action: () => clipboardText.writeText(id),
		});
	}
	return items;
}
