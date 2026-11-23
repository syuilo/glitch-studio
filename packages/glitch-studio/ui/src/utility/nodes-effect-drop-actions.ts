import { importAssets } from './import-assets.ts';
import { createNodesEffectAssetNode } from './nodes-effect-asset-node.ts';
import { findNodesEffectOwner } from './nodes-effect-target.ts';
import type { ProjectContext } from '../Project.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { NodesEffectTarget } from './nodes-effect-target.ts';
import type { NodesEffectAssetPlacement } from './nodes-effect-asset-node.ts';
import type { NodesEffectAssetDropActions } from '../types/nodes-effect-editor.ts';

/** 登録済み・インラインの保存先は親が指定し、共通Editorはドロップの表示と受付だけを担当する。 */
export function createNodesEffectDropActions(options: {
	context: ProjectContext; projectSessionId: string; target: NodesEffectTarget; isActive: () => boolean; revealAssets: () => void;
}): NodesEffectAssetDropActions {
	const { context, target, isActive, revealAssets } = options;
	const nodesEffect = findNodesEffectOwner(context.stateManager.state, target);
	const active = () => isActive() && nodesEffect != null && findNodesEffectOwner(context.stateManager.state, target) === nodesEffect;

	function prepare(assets: readonly Asset[]): NodesEffectAssetPlacement {
		return { target, nodes: assets.flatMap(asset => createNodesEffectAssetNode(asset) ?? []) };
	}

	async function dropFiles(files: readonly File[]) {
		const acceptedFiles = files.filter(file => !/^(video|audio)\//.test(file.type));
		if (acceptedFiles.length === 0 || !active()) return false;
		let added = 0;
		let unplaced = false;
		const ids = await importAssets(context, acceptedFiles, (assets, dialog) => {
			if (!active()) { unplaced = true; return null; }
			dialog.setText('Adding Nodes Effect nodes');
			dialog.setProgress(null);
			dialog.setSubProgress(undefined);
			const placement = prepare(assets);
			added = placement.nodes.length;
			unplaced = added < assets.length;
			return { nodesEffect: placement };
		});
		if (ids.length > 0 && unplaced) revealAssets();
		return ids.length > 0 && added > 0;
	}

	async function dropAsset(assetId: string) {
		const asset = context.stateManager.state.assets.value.find(asset => asset.id === assetId);
		if (asset == null || !active()) return false;
		const placement = prepare([asset]);
		if (placement.nodes.length === 0) return false;
		context.stateManager.commit('insertNodesEffectAssetNodes', { placement });
		return true;
	}

	return { projectSessionId: options.projectSessionId, dropFiles, dropAsset };
}
