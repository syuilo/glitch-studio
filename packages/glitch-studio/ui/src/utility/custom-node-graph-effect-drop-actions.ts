import { importAssets } from './import-assets.ts';
import { createCustomNodeGraphEffectAssetNode } from './custom-node-graph-effect-asset-node.ts';
import { findCustomNodeGraphEffectOwner } from './custom-node-graph-effect-target.ts';
import type { ProjectContext } from '../Project.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { CustomNodeGraphEffectTarget } from './custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectAssetPlacement } from './custom-node-graph-effect-asset-node.ts';
import type { CustomNodeGraphEffectAssetDropActions } from '../types/custom-node-graph-effect-editor.ts';

/** 登録済み・インラインの保存先は親が指定し、共通Editorはドロップの表示と受付だけを担当する。 */
export function createCustomNodeGraphEffectDropActions(options: {
	context: ProjectContext; projectSessionId: string; target: CustomNodeGraphEffectTarget; isActive: () => boolean; revealAssets: () => void;
}): CustomNodeGraphEffectAssetDropActions {
	const { context, target, isActive, revealAssets } = options;
	const customNodeGraphEffect = findCustomNodeGraphEffectOwner(context.stateManager.state, target);
	const active = () => isActive() && customNodeGraphEffect != null && findCustomNodeGraphEffectOwner(context.stateManager.state, target) === customNodeGraphEffect;

	function prepare(assets: readonly Asset[], availablePlayers: readonly Player[]) {
		const placement: CustomNodeGraphEffectAssetPlacement = { target, nodes: [] };
		const players: Player[] = [];
		for (const asset of assets) {
			const prepared = createCustomNodeGraphEffectAssetNode(asset, [...availablePlayers, ...players]);
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
		const ids = await importAssets(context, files, (assets, players, dialog) => {
			if (!active()) { unplaced = true; return null; }
			dialog.setText('Adding Custom Node Graph Effect nodes');
			dialog.setProgress(null);
			dialog.setSubProgress(undefined);
			const prepared = prepare(assets, [...context.stateManager.state.players.value, ...players]);
			players.push(...prepared.players);
			added = prepared.placement.nodes.length;
			unplaced = added < assets.length;
			return { customNodeGraphEffect: prepared.placement };
		});
		if (ids.length > 0 && unplaced) revealAssets();
		return ids.length > 0 && added > 0;
	}

	async function dropAsset(assetId: string) {
		const asset = context.stateManager.state.assets.value.find(asset => asset.id === assetId);
		if (asset == null || !active()) return false;
		const prepared = prepare([asset], context.stateManager.state.players.value);
		if (prepared.placement.nodes.length === 0) return false;
		context.stateManager.commit('insertCustomNodeGraphEffectAssetNodes', { placement: prepared.placement, players: prepared.players });
		return true;
	}

	return { projectSessionId: options.projectSessionId, dropFiles, dropAsset };
}
