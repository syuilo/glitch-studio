import { importAssets } from './import-assets.ts';
import { createVisualModuleAssetNode } from './visual-module-asset-node.ts';
import { findVisualModule } from './visual-module-target.ts';
import { progress } from '../ui.ts';
import type { ProjectContext } from '../Project.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { VisualModuleTarget } from './visual-module-target.ts';
import type { VisualModuleAssetPlacement } from './visual-module-asset-node.ts';
import type { VisualModuleAssetDropActions } from '../types/visual-module-editor.ts';

/** 登録済み・インラインの保存先は親が指定し、共通Editorはドロップの表示と受付だけを担当する。 */
export function createVisualModuleDropActions(options: {
	context: ProjectContext; target: VisualModuleTarget; isActive: () => boolean; revealAssets: () => void;
}): VisualModuleAssetDropActions {
	const { context, target, isActive, revealAssets } = options;
	const visualModule = findVisualModule(context.stateManager.state, target);
	const active = () => isActive() && visualModule != null && findVisualModule(context.stateManager.state, target) === visualModule;

	function prepare(assets: readonly Asset[], availablePlayers: readonly Player[]) {
		const placement: VisualModuleAssetPlacement = { target, nodes: [] };
		const players: Player[] = [];
		for (const asset of assets) {
			const prepared = createVisualModuleAssetNode(asset, [...availablePlayers, ...players]);
			if (prepared == null) continue;
			placement.nodes.push(prepared.node);
			if (prepared.player != null) players.push(prepared.player);
		}
		return { placement, players };
	}

	async function dropFiles(files: readonly File[]) {
		if (!active()) return false;
		let added = 0;
		let unplaced = false;
		const ids = await importAssets(context, files, undefined, (assets, players, dialog) => {
			if (!active()) { unplaced = true; return null; }
			dialog.setText('Adding Visual Module nodes');
			dialog.setProgress(null);
			dialog.setSubProgress(undefined);
			const prepared = prepare(assets, [...context.stateManager.state.players.value, ...players]);
			players.push(...prepared.players);
			added = prepared.placement.nodes.length;
			unplaced = added < assets.length;
			return { visualModule: prepared.placement };
		});
		if (ids.length > 0 && unplaced) revealAssets();
		return ids.length > 0 && added > 0;
	}

	async function dropAsset(assetId: string) {
		const asset = context.stateManager.state.assets.value.find(asset => asset.id === assetId);
		if (asset == null || !active()) return false;
		const prepared = prepare([asset], context.stateManager.state.players.value);
		if (prepared.placement.nodes.length === 0) return false;
		const dialog = progress({ text: 'Adding Visual Module nodes' });
		try {
			context.stateManager.commit('addVisualModuleAssetNodes', { placement: prepared.placement, players: prepared.players });
			return true;
		} finally { dialog.done(); }
	}

	return { dropFiles, dropAsset };
}
