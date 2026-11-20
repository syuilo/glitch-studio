import * as z from 'zod';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { ref } from 'vue';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import { getScene } from '../utility/timeline-scene.ts';
import { getCustomNodeGraphEffect, saveCustomNodeGraphEffect } from '../utility/custom-node-graph-effect-target.ts';
import { defineCommand, definePublicCommand } from './definition.ts';
import { playerSourceSchema } from './project-contract-schemas.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { prepareProjectEffectPlacementChanges } from './project-effect-placements.ts';
import { getTimelineAssetPlacementChanges, validateTimelineAssetPlacement, removeTimelineAssetPlacement } from './timeline.ts';
import type { Player } from '@gs/shared/types.ts';
import type { AppStateChange, ProjectState, ProjectAsset } from '../Project.ts';
import type { CustomNodeGraphEffectAssetPlacement } from '../utility/custom-node-graph-effect-asset-node.ts';
import type { AssetImportPlacement } from '../utility/import-assets.ts';

// ファイルの読み込みやダイアログは呼び出し側が済ませ、取り込み済みの値だけを渡す。
// 配置との参照関係を保つため、この内部取り込み操作では生成済みのIDを維持する。
export const insertImportedAssetsCommandDef = defineCommand<{ assets: ProjectAsset[]; players: Player[] } & AssetImportPlacement>({
	label: 'Import assets',
	prepare(state, input) {
		for (const [existing, added] of [[state.assets.value, input.assets], [state.players.value, input.players]]) {
			const ids = new Set(existing.map(resource => resource.id));
			for (const resource of added) {
				if (resource.id.length === 0 || ids.has(resource.id)) throw new Error('Resource ID already exists');
				ids.add(resource.id);
			}
		}
		const saved = deepClone(input);
		const draft = { ...state, assets: ref([...state.assets.value, ...saved.assets]), players: ref([...state.players.value, ...saved.players]) };
		if (saved.timeline != null) validateTimelineAssetPlacement(draft, saved.timeline);
		if (saved.customNodeGraphEffect != null) validateCustomNodeGraphEffectAssetPlacement(draft, saved.customNodeGraphEffect);
		const changes: AppStateChange[] = [
			...saved.assets.map(asset => ({ type: 'asset' as const, assetId: asset.id })),
			...saved.players.map(player => ({ type: 'player' as const, playerId: player.id })),
			...getTimelineAssetPlacementChanges(saved.timeline ?? null),
			...getCustomNodeGraphEffectAssetPlacementChanges(saved.customNodeGraphEffect ?? null),
		];
		if (changes.length === 0) return { result: undefined, change: null };
		return {
			result: undefined,
			change: {
				changes,
				apply(current) {
					current.assets.value.push(...deepClone(saved.assets));
					current.players.value.push(...deepClone(saved.players));
					if (saved.timeline != null) getScene(current, saved.timeline.sceneId).layers.unshift(...deepClone(saved.timeline.layers));
					if (saved.customNodeGraphEffect != null) appendCustomNodeGraphEffectAssetNodes(current, saved.customNodeGraphEffect);
				},
				revert(current) {
					const assetIds = new Set(saved.assets.map(asset => asset.id));
					const playerIds = new Set(saved.players.map(player => player.id));
					current.assets.value = current.assets.value.filter(asset => !assetIds.has(asset.id));
					current.players.value = current.players.value.filter(player => !playerIds.has(player.id));
					if (saved.timeline != null) removeTimelineAssetPlacement(current, saved.timeline);
					if (saved.customNodeGraphEffect != null) removeCustomNodeGraphEffectAssetNodes(current, saved.customNodeGraphEffect);
				},
			},
		};
	},
});

export function getCustomNodeGraphEffectAssetPlacementChanges(placement: CustomNodeGraphEffectAssetPlacement | null): AppStateChange[] {
	return placement == null || placement.nodes.length === 0 ? [] : [{ type: 'customNodeGraphEffect', target: placement.target }];
}

/** リソースの追加前に全ノードと参照を検証し、Undo不能な部分反映を残さない。 */
export function validateCustomNodeGraphEffectAssetPlacement(state: ProjectState, placement: CustomNodeGraphEffectAssetPlacement) {
	const customNodeGraphEffect = getCustomNodeGraphEffect(state, placement.target);
	const ids = new Set(customNodeGraphEffect.nodes.map(node => node.id));
	for (const node of placement.nodes) {
		if (ids.has(node.id)) throw new Error('Duplicate node ID');
		ids.add(node.id);
		if (node.effectSource.type !== 'nativeEffect') throw new Error('Unsupported asset node');
		if (node.effectSource.id === 'image') {
			const image = node.staticSettings.image;
			if (typeof image !== 'string' || !state.assets.value.some(asset => asset.id === image && asset.fileDataType.startsWith('image/'))) throw new Error('Image asset not found');
			continue;
		}
		let playerId: unknown = null;
		if (node.effectSource.id === 'video') playerId = node.staticSettings.player;
		else if (node.effectSource.id === 'audioWaveform' && node.params.audio?.inputSource === 'literal') {
			const audio = node.params.audio.value;
			if (audio != null && typeof audio === 'object' && 'type' in audio && audio.type === 'player' && 'playerId' in audio) playerId = audio.playerId;
		} else throw new Error('Unsupported asset node');
		const player = state.players.value.find(player => player.id === playerId);
		const assetType = node.effectSource.id === 'video' ? 'video/' : 'audio/';
		if (player?.sourceType !== 'asset' || !state.assets.value.some(asset => asset.id === player.assetId && asset.fileDataType.startsWith(assetType))) throw new Error('Media player asset not found');
	}
}

export function appendCustomNodeGraphEffectAssetNodes(state: ProjectState, placement: CustomNodeGraphEffectAssetPlacement) {
	const customNodeGraphEffect = getCustomNodeGraphEffect(state, placement.target);
	const outputIndex = customNodeGraphEffect.nodes.findIndex(node => node.type === 'globalOut');
	customNodeGraphEffect.nodes.splice(outputIndex < 0 ? customNodeGraphEffect.nodes.length : outputIndex, 0, ...deepClone(placement.nodes));
	saveCustomNodeGraphEffect(state, placement.target, customNodeGraphEffect);
}

export function removeCustomNodeGraphEffectAssetNodes(state: ProjectState, placement: CustomNodeGraphEffectAssetPlacement) {
	const ids = new Set(placement.nodes.map(node => node.id));
	const customNodeGraphEffect = getCustomNodeGraphEffect(state, placement.target);
	customNodeGraphEffect.nodes = customNodeGraphEffect.nodes.filter(node => !ids.has(node.id));
	saveCustomNodeGraphEffect(state, placement.target, customNodeGraphEffect);
}

export const insertCustomNodeGraphEffectAssetNodesCommandDef = defineCommand<{ placement: CustomNodeGraphEffectAssetPlacement; players: Player[] }>({
	label: 'Insert asset nodes',
	prepare(state, input) {
		return insertImportedAssetsCommandDef.prepare(state, { assets: [], players: input.players, customNodeGraphEffect: input.placement });
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
	description: 'Remove an existing Asset and clear its static-setting references on nodes in registered and inline Custom Node Graph Effects. Other saved references can become unresolved. Undo restores the Asset and cleared references; no source file is deleted.',
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

export type PlayerSource = null | { type: 'asset'; assetId: string } | { type: 'webcam' | 'microphone' | 'liveStream' };

function playerSourceFields(state: ProjectState, source: PlayerSource): Pick<Player, 'sourceType' | 'assetId'> {
	if (source == null) return { sourceType: null, assetId: null };
	if (!['asset', 'webcam', 'microphone', 'liveStream'].includes(source.type)) throw new Error('Invalid Player source type');
	if (source.type === 'asset') getAsset(state, source.assetId);
	return { sourceType: source.type, assetId: source.type === 'asset' ? source.assetId : null };
}

export const createPlayerCommandDef = definePublicCommand({
	label: 'Create player',
	inputSchema: z.object({ name: z.string().nullish().describe('Omit or pass null for Player.'), source: playerSourceSchema.nullish().describe('Omit or pass null for an unassigned source.') }),
	resultSchema: z.object({ playerId: z.string() }),
	description: 'Create a Player and return its reference. Asset sources must already exist in the project. Selecting a capture source stores its type; this does not grant device permission or guarantee live input.',
	examples: ['let player = Command:createPlayer({ name: "Input" })\n<: Query:getPlayer(player)'],
	prepare(state, input) {
		if (input.name != null && typeof input.name !== 'string') throw new Error('Player name must be a string');
		const player: Player = { id: genId(), name: input.name ?? 'Player', ...playerSourceFields(state, input.source ?? null) };
		return {
			result: { playerId: player.id },
			change: {
				changes: [{ type: 'player', playerId: player.id }],
				apply(current) { current.players.value.push(deepClone(player)); },
				revert(current) { current.players.value = current.players.value.filter(candidate => candidate.id !== player.id); },
			},
		};
	},
});

export const setPlayerSourceCommandDef = definePublicCommand({
	label: 'Set player source',
	inputSchema: z.object({ playerId: z.string().min(1), source: playerSourceSchema }),
	resultSchema: z.null(),
	description: 'Replace a Player source. Pass null to disconnect it, an existing Asset ID for asset input, or a capture source type. This does not import files.',
	examples: ['let player = Command:createPlayer({})\nCommand:setPlayerSource({ playerId: player.playerId, source: null })'],
	prepare(state, { playerId, source }) {
		const player = state.players.value.find(candidate => candidate.id === playerId);
		if (player == null) throw new Error('Player not found');
		return prepareProjectValueChange({
			before: { sourceType: player.sourceType, assetId: player.assetId ?? null },
			after: playerSourceFields(state, source),
			result: undefined,
			changes: [{ type: 'player', playerId }],
			write(current, value) { Object.assign(current.players.value.find(candidate => candidate.id === playerId)!, value); },
		});
	},
});

export const RESOURCES_COMMAND_DEFS = {
	createAsset: createAssetCommandDef,
	insertImportedAssets: insertImportedAssetsCommandDef,
	insertCustomNodeGraphEffectAssetNodes: insertCustomNodeGraphEffectAssetNodesCommandDef,
	removeAsset: removeAssetCommandDef,
	setAssetName: setAssetNameCommandDef,
	replaceAssetSource: replaceAssetSourceCommandDef,
	createPlayer: createPlayerCommandDef,
	setPlayerSource: setPlayerSourceCommandDef,
};
