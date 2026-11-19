import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { validatePlayerAudioSourceSelection } from './player-audio-source.ts';
import { createProjectEffectDefinitions } from './project/effects.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingDefinition } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { NativeEffectDefinitions } from './project/effects.ts';
import type { CustomNodeGraphEffectEditorMetadata, ProjectEffectRegistrations } from './project/types.ts';

export type CustomNodeGraphEffectResources = ProjectEffectRegistrations & CustomNodeGraphEffectEditorMetadata & {
	customNodeGraphEffect: CustomNodeGraphEffect;
	assets: Asset[];
	players: Player[];
};

type ResourceKind = 'asset' | 'player' | 'customShaderEffect' | 'customNodeGraphEffect';

function indexResources<T extends { id: string }>(resources: T[]): Map<string, T> {
	const indexed = new Map(resources.map(resource => [resource.id, resource]));
	if (indexed.size !== resources.length) throw new Error('Duplicate resource IDs in the Custom Node Graph Effect file.');
	return indexed;
}

// 保存可能なEffect定義と編集情報はレコード・配列・リテラルの木。共有されたBindingやProxyも配置ごとに
// 複製し、取り込み時の書き換えが他の配置へ波及するのを防ぐ。ポートIDは任意の文字列のままキーにできる。
function copyEffectData<T>(value: T): T {
	if (Array.isArray(value)) return value.map(copyEffectData) as T;
	if (value == null || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyEffectData(child)])) as T;
}

/** .gscngeとWeb書き出しで使うスナップショット。取り込み時は種類ごとに新しいIDを割り当てる。 */
export function collectCustomNodeGraphEffectResources(input: CustomNodeGraphEffectResources, nativeDefinitions: NativeEffectDefinitions,
	assignId: (kind: ResourceKind, id: string) => string = (_kind, id) => id): CustomNodeGraphEffectResources {
	const definitions = createProjectEffectDefinitions(input, nativeDefinitions);
	const customShaderEffectIds = new Set<string>();
	const customNodeGraphEffectIds = new Set<string>();
	// 未接続のノードも保存対象。循環を検査する走査で参照先を記録し、巨大なプロジェクト全体の複製を避ける。
	validateEffectSource({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: input.customNodeGraphEffect }, {
		...definitions,
		getCustomShaderEffect(id) {
			customShaderEffectIds.add(id);
			return definitions.getCustomShaderEffect(id);
		},
		getCustomNodeGraphEffect(id) {
			customNodeGraphEffectIds.add(id);
			return definitions.getCustomNodeGraphEffect(id);
		},
	});
	const snapshot = copyEffectData({
		...(input.nodeMetadata == null ? {} : { nodeMetadata: input.nodeMetadata }),
		customNodeGraphEffect: input.customNodeGraphEffect,
		customShaderEffects: input.customShaderEffects.filter(entry => customShaderEffectIds.has(entry.id)),
		customNodeGraphEffects: input.customNodeGraphEffects.filter(entry => customNodeGraphEffectIds.has(entry.id)),
	});
	const shaderIds = new Map(snapshot.customShaderEffects.map(entry => [entry.id, assignId('customShaderEffect', entry.id)]));
	const graphIds = new Map(snapshot.customNodeGraphEffects.map(entry => [entry.id, assignId('customNodeGraphEffect', entry.id)]));
	const availableAssets = indexResources(input.assets);
	const availablePlayers = indexResources(input.players);
	const assets = new Map<string, Asset>();
	const players = new Map<string, Player>();

	function collectAsset(id: string): string {
		const existing = assets.get(id);
		if (existing != null) return existing.id;
		const asset = availableAssets.get(id);
		if (asset == null) throw new Error('Missing Asset: ' + id);
		// 元ファイルの絶対パスなど、取り込み元PC固有の情報は同梱しない。
		const { name, width, height, fileDataType, fileData, hash } = asset;
		const newId = assignId('asset', id);
		assets.set(id, {
			id: newId, name, width, height, fileDataType,
			fileData: fileData instanceof Blob ? fileData : { url: fileData.url, size: fileData.size, error: fileData.error },
			...(hash == null ? {} : { hash }),
		});
		return newId;
	}

	function collectPlayer(id: string): string {
		const existing = players.get(id);
		if (existing != null) return existing.id;
		const player = availablePlayers.get(id);
		if (player == null) throw new Error('Missing Player: ' + id);
		const newId = assignId('player', id);
		const { name, sourceType } = player;
		players.set(id, {
			id: newId, name, sourceType,
			...(sourceType === 'asset' ? { assetId: player.assetId == null ? null : collectAsset(player.assetId) } : {}),
		});
		return newId;
	}

	function mapSetting(setting: StaticSettingDefinition, id: string): string {
		if (setting.dataType.kind === 'assetReference') return collectAsset(id);
		if (setting.dataType.kind === 'playerReference') return collectPlayer(id);
		return id;
	}

	function mapAudioBinding(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding): void {
		for (const { def, param } of walkParameterLeaves<CustomNodeGraphEffectParameterBinding>({ value: definition }, { value: binding })) {
			if (def.dataType.kind !== 'audioSource' || param.inputSource === 'customNodeGraphEffectPublicParameterReference') continue;
			if (param.inputSource !== 'literal') throw new Error('Audio sources must use a static input');
			validatePlayerAudioSourceSelection(param.value);
			if (param.value != null) param.value = { type: 'player', playerId: collectPlayer(param.value.playerId) };
		}
	}

	function mapParameterDefaults(definition: ParameterDefinition): void {
		mapAudioBinding(definition, definition.defaultValue);
		if (definition.dataType.kind === 'array') mapParameterDefaults(getArrayElementDefinition(definition));
		if (definition.dataType.kind === 'struct') for (const field of Object.values(getStructFieldDefinitions(definition))) mapParameterDefaults(field);
	}

	function mapDefinitionDefaults(definition: EffectDefinition): void {
		for (const setting of Object.values(definition.staticSettingDefs ?? {})) {
			if (typeof setting.defaultValue === 'string') setting.defaultValue = mapSetting(setting, setting.defaultValue);
		}
		for (const parameter of Object.values(definition.paramDefs)) mapParameterDefaults(parameter);
	}

	function mapSource(source: EffectSource): EffectSource {
		switch (source.type) {
			case 'nativeEffect': return source;
			case 'customShaderEffectReference': return { ...source, id: shaderIds.get(source.id)! };
			case 'customNodeGraphEffectReference': return { ...source, id: graphIds.get(source.id)! };
			case 'inlineCustomShaderEffect':
				mapDefinitionDefaults(source.customShaderEffect);
				return source;
			case 'inlineCustomNodeGraphEffect': return { ...source, customNodeGraphEffect: mapGraph(source.customNodeGraphEffect) };
		}
	}

	function mapGraph(graph: CustomNodeGraphEffect): CustomNodeGraphEffect {
		mapDefinitionDefaults(graph);
		return { ...graph, nodes: graph.nodes.map(node => {
			if (node.type === 'relay') return node;
			const { definition } = resolveEffectSource(node.effectSource, definitions);
			for (const [key, binding] of Object.entries(node.params)) mapAudioBinding(definition.paramDefs[key], binding);
			// Custom Effectの未指定値は同梱する定義に従う。外部カタログにあるNative Effectの
			// 素材参照だけはこの配置に固定し、取り込み先のIDへ書き換えられるようにする。
			const references: [string, string][] = [];
			for (const [key, setting] of Object.entries(definition.staticSettingDefs ?? {})) {
				if (setting.dataType.kind !== 'assetReference' && setting.dataType.kind !== 'playerReference') continue;
				const hasValue = node.staticSettings != null && Object.hasOwn(node.staticSettings, key);
				if (!hasValue && node.effectSource.type !== 'nativeEffect') continue;
				const value = hasValue ? node.staticSettings![key] : setting.defaultValue;
				if (typeof value === 'string') references.push([key, mapSetting(setting, value)]);
			}
			const effectSource = mapSource(node.effectSource);
			return references.length === 0 ? { ...node, effectSource }
				: { ...node, effectSource, staticSettings: { ...node.staticSettings, ...Object.fromEntries(references) } };
		}) };
	}

	const customNodeGraphEffect = mapGraph(snapshot.customNodeGraphEffect);
	for (const entry of snapshot.customShaderEffects) {
		entry.id = shaderIds.get(entry.id)!;
		mapDefinitionDefaults(entry.definition);
	}
	for (const entry of snapshot.customNodeGraphEffects) {
		entry.id = graphIds.get(entry.id)!;
		entry.definition = mapGraph(entry.definition);
	}
	return { ...snapshot, customNodeGraphEffect, assets: [...assets.values()], players: [...players.values()] };
}
