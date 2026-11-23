import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { createProjectEffectDefinitions } from './project/effects.ts';
import { validateProjectEffectRegistrations } from './project/validate-effect-registrations.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { NativeEffectDefinitions } from './project/effects.ts';
import type { CustomNodeGraphEffectEditorMetadata, ProjectEffectRegistrations } from './project/types.ts';

export type CustomNodeGraphEffectResources = ProjectEffectRegistrations & CustomNodeGraphEffectEditorMetadata & {
	customNodeGraphEffect: CustomNodeGraphEffect;
	assets: Asset[];
};

type ResourceKind = 'asset' | 'customShaderEffect' | 'customNodeGraphEffect';

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

/**
 * .gscngeとWeb書き出しで使うスナップショット。素材を非同期で読み出す間に参照先が変わらないよう、先に定義と参照を確定する。
 * 取り込み時は種類ごとに新しいIDを割り当てる。
 */
export function collectCustomNodeGraphEffectResources(input: CustomNodeGraphEffectResources, nativeDefinitions: NativeEffectDefinitions,
	assignId: (kind: ResourceKind, id: string) => string = (_kind, id) => id): CustomNodeGraphEffectResources {
	validateProjectEffectRegistrations(input);
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
	const assets = new Map<string, Asset>();

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

	function mapDefinitionDefaults(definition: EffectDefinition): void {
		for (const setting of Object.values(definition.staticSettingDefs ?? {})) {
			if (setting.dataType.kind === 'assetReference' && typeof setting.defaultValue === 'string') setting.defaultValue = collectAsset(setting.defaultValue);
		}
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
			// Custom Effectの未指定値は同梱する定義に従う。外部カタログにあるNative Effectの
			// 素材参照だけはこの配置に固定し、取り込み先のIDへ書き換えられるようにする。
			const references: [string, string][] = [];
			for (const [key, setting] of Object.entries(definition.staticSettingDefs ?? {})) {
				if (setting.dataType.kind !== 'assetReference') continue;
				const hasValue = node.staticSettings != null && Object.hasOwn(node.staticSettings, key);
				if (!hasValue && node.effectSource.type !== 'nativeEffect') continue;
				const value = hasValue ? node.staticSettings![key] : setting.defaultValue;
				if (typeof value === 'string') references.push([key, collectAsset(value)]);
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
	return { ...snapshot, customNodeGraphEffect, assets: [...assets.values()] };
}
