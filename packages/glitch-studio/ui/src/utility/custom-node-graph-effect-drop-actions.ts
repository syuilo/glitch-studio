import { importAssets } from './import-assets.ts';
import { createCustomNodeGraphEffectAssetNode } from './custom-node-graph-effect-asset-node.ts';
import { findCustomNodeGraphEffectOwner } from './custom-node-graph-effect-target.ts';
import type { ProjectContext } from '../Project.ts';
import type { Asset } from '@gs/shared/types.ts';
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

	function prepare(assets: readonly Asset[]): CustomNodeGraphEffectAssetPlacement {
		return { target, nodes: assets.flatMap(asset => createCustomNodeGraphEffectAssetNode(asset) ?? []) };
	}

	async function dropFiles(files: readonly File[]) {
		const acceptedFiles = files.filter(file => !/^(video|audio)\//.test(file.type));
		if (acceptedFiles.length === 0 || !active()) return false;
		let added = 0;
		let unplaced = false;
		const ids = await importAssets(context, acceptedFiles, (assets, dialog) => {
			if (!active()) { unplaced = true; return null; }
			dialog.setText('Adding Custom Node Graph Effect nodes');
			dialog.setProgress(null);
			dialog.setSubProgress(undefined);
			const placement = prepare(assets);
			added = placement.nodes.length;
			unplaced = added < assets.length;
			return { customNodeGraphEffect: placement };
		});
		if (ids.length > 0 && unplaced) revealAssets();
		return ids.length > 0 && added > 0;
	}

	async function dropAsset(assetId: string) {
		const asset = context.stateManager.state.assets.value.find(asset => asset.id === assetId);
		if (asset == null || !active()) return false;
		const placement = prepare([asset]);
		if (placement.nodes.length === 0) return false;
		context.stateManager.commit('insertCustomNodeGraphEffectAssetNodes', { placement });
		return true;
	}

	return { projectSessionId: options.projectSessionId, dropFiles, dropAsset };
}
