import * as z from 'zod';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { ref } from 'vue';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getScene } from '../utility/timeline-scene.ts';
import { getNodesEffect, saveNodesEffect } from '../utility/nodes-effect-target.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { prepareProjectEffectPlacementChanges } from './project-effect-placements.ts';
import { getTimelineAssetPlacementChanges, validateTimelineAssetPlacement, removeTimelineAssetPlacement } from './timeline.ts';
import type { AppStateChange, ProjectState, ProjectAsset } from '../Project.ts';
import type { NodesEffectAssetPlacement } from '../utility/nodes-effect-asset-node.ts';
import type { AssetImportPlacement } from '../utility/import-assets.ts';

// ファイルの読み込みやダイアログは呼び出し側が済ませ、取り込み済みの値だけを渡す。
// 配置との参照関係を保つため、この内部取り込み操作では生成済みのIDを維持する。
export const insertImportedAssetsCommandDef = defineCommand<{ assets: ProjectAsset[] } & AssetImportPlacement>({
	label: 'Import assets',
	prepare(state, input) {
		const ids = new Set(state.assets.value.map(asset => asset.id));
		for (const asset of input.assets) {
			if (asset.id.length === 0 || ids.has(asset.id)) throw new Error('Resource ID already exists');
			ids.add(asset.id);
		}
		const saved = deepClone(input);
		const draft = { ...state, assets: ref([...state.assets.value, ...saved.assets]) };
		if (saved.timeline != null) validateTimelineAssetPlacement(draft, saved.timeline);
		if (saved.nodesEffect != null) validateNodesEffectAssetPlacement(draft, saved.nodesEffect);
		const changes: AppStateChange[] = [
			...saved.assets.map(asset => ({ type: 'asset' as const, assetId: asset.id })),
			...getTimelineAssetPlacementChanges(saved.timeline ?? null),
			...getNodesEffectAssetPlacementChanges(saved.nodesEffect ?? null),
		];
		if (changes.length === 0) return { result: undefined, change: null };
		return {
			result: undefined,
			change: {
				changes,
				apply(current) {
					current.assets.value.push(...deepClone(saved.assets));
					if (saved.timeline != null) getScene(current, saved.timeline.sceneId).layers.unshift(...deepClone(saved.timeline.layers));
					if (saved.nodesEffect != null) appendNodesEffectAssetNodes(current, saved.nodesEffect);
				},
				revert(current) {
					const assetIds = new Set(saved.assets.map(asset => asset.id));
					current.assets.value = current.assets.value.filter(asset => !assetIds.has(asset.id));
					if (saved.timeline != null) removeTimelineAssetPlacement(current, saved.timeline);
					if (saved.nodesEffect != null) removeNodesEffectAssetNodes(current, saved.nodesEffect);
				},
			},
		};
	},
});

export function getNodesEffectAssetPlacementChanges(placement: NodesEffectAssetPlacement | null): AppStateChange[] {
	return placement == null || placement.nodes.length === 0 ? [] : [{ type: 'nodesEffect', target: placement.target }];
}

/** リソースの追加前に全ノードと参照を検証し、Undo不能な部分反映を残さない。 */
export function validateNodesEffectAssetPlacement(state: ProjectState, placement: NodesEffectAssetPlacement) {
	const nodesEffect = getNodesEffect(state, placement.target);
	const ids = new Set(nodesEffect.nodes.map(node => node.id));
	for (const node of placement.nodes) {
		if (ids.has(node.id)) throw new Error('Duplicate node ID');
		ids.add(node.id);
		if (node.effectSource.type !== 'nativeEffect' || node.effectSource.id !== 'image') throw new Error('Unsupported asset node');
		const image = node.staticSettings.image;
		if (typeof image !== 'string' || !state.assets.value.some(asset => asset.id === image && asset.fileDataType.startsWith('image/'))) throw new Error('Image asset not found');
	}
}

export function appendNodesEffectAssetNodes(state: ProjectState, placement: NodesEffectAssetPlacement) {
	const nodesEffect = getNodesEffect(state, placement.target);
	const outputIndex = nodesEffect.nodes.findIndex(node => node.type === 'globalOut');
	nodesEffect.nodes.splice(outputIndex < 0 ? nodesEffect.nodes.length : outputIndex, 0, ...deepClone(placement.nodes));
	saveNodesEffect(state, placement.target, nodesEffect);
}

export function removeNodesEffectAssetNodes(state: ProjectState, placement: NodesEffectAssetPlacement) {
	const ids = new Set(placement.nodes.map(node => node.id));
	const nodesEffect = getNodesEffect(state, placement.target);
	nodesEffect.nodes = nodesEffect.nodes.filter(node => !ids.has(node.id));
	saveNodesEffect(state, placement.target, nodesEffect);
}

export const insertNodesEffectAssetNodesCommandDef = defineCommand<{ placement: NodesEffectAssetPlacement }>({
	label: 'Insert asset nodes',
	prepare(state, input) {
		return insertImportedAssetsCommandDef.prepare(state, { assets: [], nodesEffect: input.placement });
	},
});

function getAsset(state: ProjectState, assetId: string): ProjectAsset {
	const asset = state.assets.value.find(candidate => candidate.id === assetId);
	if (asset == null) throw new Error('Asset not found');
	return asset;
}

export const createAssetCommandDef = defineCommand<{ asset: Omit<ProjectAsset, 'id'> }, { assetId: string }>({
	label: 'Create asset',
	prepare(_state, input) {
		const asset = deepClone({ ...input.asset, id: genId() });
		return { result: { assetId: asset.id }, change: {
			changes: [{ type: 'asset', assetId: asset.id }],
			apply(state) { state.assets.value.push(deepClone(asset)); },
			revert(state) { state.assets.value = state.assets.value.filter(candidate => candidate.id !== asset.id); },
		} };
	},
});

export const removeAssetCommandDef = definePublicCommand({
	label: 'Remove asset',
	inputSchema: z.object({ assetId: z.string().min(1) }),
	resultSchema: z.null(),
	description: 'Remove an existing Asset and clear its static-setting references on nodes in registered and inline Nodes Effects. Other saved references can become unresolved. Undo restores the Asset and cleared references; no source file is deleted.',
	examples: ['let assets = Query:listAssets()\nif (assets.len > 0) { Command:removeAsset(assets[0].target) }'],
	prepare(state, { assetId }) {
		const asset = deepClone(getAsset(state, assetId));
		const assetIndex = state.assets.value.findIndex(candidate => candidate.id === assetId);
		const definitions = getEffectDefinitions(state);
		const references = prepareProjectEffectPlacementChanges(state, {
			node(node) {
				const matching = Object.entries(node.staticSettings ?? {}).filter(([, value]) => value === assetId);
				if (matching.length === 0) return null;
				const settings = resolveEffectSource(node.effectSource, definitions).definition.staticSettingDefs;
				const keys = matching.map(([key]) => key).filter(key => settings?.[key]?.dataType.kind === 'assetReference');
				if (keys.length === 0) return null;
				return (current, restore) => {
					for (const key of keys) current.staticSettings![key] = restore ? assetId : null;
				};
			},
		});
		return {
			result: undefined,
			change: {
				changes: [{ type: 'asset', assetId }, ...references.changes],
				apply(current) { current.assets.value = current.assets.value.filter(candidate => candidate.id !== assetId); references.apply(current); },
				revert(current) {
					// 別素材に対するUndo対象外のリロードを巻き戻さないよう、削除した値だけを戻す。
					current.assets.value.splice(assetIndex, 0, deepClone(asset));
					references.revert(current);
				},
			},
		};
	},
});

export const setAssetNameCommandDef = definePublicCommand({
	label: 'Set asset name',
	inputSchema: z.object({ assetId: z.string().min(1), name: z.string() }),
	resultSchema: z.null(),
	description: 'Rename an existing Asset in the project. The original file name and file contents are unchanged.',
	examples: ['let assets = Query:listAssets()\nif (assets.len > 0) { Command:setAssetName({ assetId: assets[0].id, name: "Texture" }) }'],
	getAutoMergeKey: input => `asset:${input.assetId}:name`,
	prepare(state, { assetId, name }) {
		if (typeof name !== 'string') throw new Error('Asset name must be a string');
		return prepareProjectValueChange({
			before: getAsset(state, assetId).name,
			after: name,
			result: undefined,
			changes: [{ type: 'asset', assetId }],
			write(current, value) { getAsset(current, assetId).name = value; },
		});
	},
});

export const replaceAssetSourceCommandDef = defineCommand<{ assetId: string; source: Omit<ProjectAsset, 'id' | 'name'> }>({
	label: 'Replace asset source',
	prepare(state, { assetId, source }) {
		const { id: _id, name: _name, ...previous } = getAsset(state, assetId);
		const before = deepClone(previous);
		const after = deepClone(source);
		// Blobは内容比較をしない。同じBlobかどうかで判定し、異なるファイルを空のobjectとして同一視しない。
		const { fileData: beforeFile, thumbnailSequence: beforeThumbnails, ...beforeMetadata } = before;
		const { fileData: afterFile, thumbnailSequence: afterThumbnails, ...afterMetadata } = after;
		const sameFile = beforeFile instanceof Blob || afterFile instanceof Blob ? beforeFile === afterFile : deepEqual(beforeFile, afterFile);
		const sameThumbnails = beforeThumbnails == null || afterThumbnails == null ? beforeThumbnails == null && afterThumbnails == null
			: beforeThumbnails.width === afterThumbnails.width && beforeThumbnails.height === afterThumbnails.height
				&& beforeThumbnails.frames.length === afterThumbnails.frames.length
				&& beforeThumbnails.frames.every((frame, index) => frame.timestampSeconds === afterThumbnails.frames[index].timestampSeconds && frame.fileData === afterThumbnails.frames[index].fileData);
		if (sameFile && sameThumbnails && deepEqual(beforeMetadata, afterMetadata)) return { result: undefined, change: null };
		const write = (current: ProjectState, value: typeof before) => {
			const asset = getAsset(current, assetId);
			const next = { ...deepClone(value), id: asset.id, name: asset.name };
			// 原本情報は部分更新ではなく置換する。省略された任意項目も残さず、
			// UIが保持するAsset自体の参照と、原本とは独立した名前は維持する。
			// Vueの同期購読が原本のない中間状態を読まないよう、必須値は先に上書きする。
			Object.assign(asset, next);
			for (const key of Object.keys(asset)) {
				if (!Object.hasOwn(next, key)) delete (asset as Record<string, unknown>)[key];
			}
		};
		return {
			result: undefined,
			change: {
				changes: [{ type: 'asset', assetId }],
				apply(current) { write(current, after); },
				revert(current) { write(current, before); },
			},
		};
	},
});

export const RESOURCES_COMMAND_DEFS = {
	createAsset: createAssetCommandDef,
	insertImportedAssets: insertImportedAssetsCommandDef,
	insertNodesEffectAssetNodes: insertNodesEffectAssetNodesCommandDef,
	removeAsset: removeAssetCommandDef,
	setAssetName: setAssetNameCommandDef,
	replaceAssetSource: replaceAssetSourceCommandDef,
};
