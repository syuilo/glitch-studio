import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { createStaticSettingValues, validateStaticSettings } from '@gs/shared/static-setting.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { validatePlayerAudioSourceSelection } from './player-audio-source.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';

type EffectDefinitions = Readonly<Record<string, Pick<EffectDefinition, 'paramDefs' | 'staticSettingDefs'> & Partial<Pick<EffectDefinition, 'displayName'>>>>;

type ResourceReference = { kind: 'asset' | 'player'; id: string };

/** 静的設定の参照と、既存の静的な音声ルーティングだけを列挙する。 */
export function visitVisualModuleResourceReferences(visualModule: VisualModule, definitions: EffectDefinitions,
	visit: (reference: ResourceReference, replaceId: (id: string) => void) => void) {
	const visitAudioBindings = (defs: Record<string, ParameterDefinition>, bindings: Record<string, VisualModuleParameterBinding>) => {
		for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(defs, bindings)) {
			if (def.dataType.kind !== 'audioSource' || param.inputSource === 'visualModulePublicParameterReference') continue;
			if (param.inputSource !== 'literal') throw new Error('Audio sources must use a static input');
			validatePlayerAudioSourceSelection(param.value);
			if (param.value != null) visit({ kind: 'player', id: param.value.playerId }, id => { param.value = { type: 'player', playerId: id }; });
		}
	};
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		const definition = definitions[node.effectId];
		if (definition == null) throw new Error(`Unknown effect: ${node.effectId}`);
		const settings = createStaticSettingValues(definition.staticSettingDefs ?? {}, node.staticSettings);
		validateStaticSettings(definition.staticSettingDefs ?? {}, settings);
		for (const [key, setting] of Object.entries(definition.staticSettingDefs ?? {})) {
			const value = settings[key];
			if (value == null) continue;
			if (setting.dataType.kind !== 'assetReference' && setting.dataType.kind !== 'playerReference') continue;
			visit({ kind: setting.dataType.kind === 'assetReference' ? 'asset' : 'player', id: value as string }, id => { settings[key] = id; });
		}
		node.staticSettings = settings;
		visitAudioBindings(definition.paramDefs, node.params);
	}
	const visitDefinition = (definition: ParameterDefinition) => {
		visitAudioBindings({ default: definition }, { default: definition.defaultValue });
		if (definition.dataType.kind === 'array') visitDefinition(getArrayElementDefinition(definition));
		else if (definition.dataType.kind === 'struct') for (const field of Object.values(getStructFieldDefinitions(definition))) visitDefinition(field);
	};
	for (const definition of visualModule.paramDefs) {
		validateParameterDefaultValues(definition);
		visitDefinition(definition);
	}
}

function indexResources<T extends { id: string }>(resources: T[]): Map<string, T> {
	const indexed = new Map(resources.map(resource => [resource.id, resource]));
	if (indexed.size !== resources.length) throw new Error('Duplicate resource IDs in the Visual Module file.');
	return indexed;
}

// .gsvmとWeb用成果物で同じ参照規則を使う。所属プロジェクトの状態は呼び出し側が渡す。
// 素材を読む前にスナップショットを確定し、元のパス・デバイス識別子を配布物へ持ち込まない。
export function collectVisualModuleResources(input: {
	visualModule: VisualModule; assets: Asset[]; players: Player[];
}, definitions: EffectDefinitions): { visualModule: VisualModule; assets: Asset[]; players: Player[] } {
	const { nodes, paramDefs, customParameterDefs, customParameterValues, outputDefs, primaryInputId, primaryOutputId, primaryAudioInputId, automationGraphs } = input.visualModule;
	const visualModule = deepClone({
		nodes,
		paramDefs,
		customParameterDefs,
		customParameterValues,
		outputDefs,
		primaryInputId,
		primaryOutputId,
		primaryAudioInputId,
		automationGraphs,
	});
	const availableAssets = indexResources(input.assets);
	const availablePlayers = indexResources(input.players);
	const assets = new Map<string, Asset>();
	const players = new Map<string, Player>();
	const addAsset = (id: string) => {
		const asset = availableAssets.get(id);
		if (asset == null) throw new Error(`Missing Asset: ${id}`);
		// 元ファイルの絶対パスなど、取り込み元PC固有の情報は同梱しない。
		const { name, width, height, fileDataType, fileData, hash } = asset;
		assets.set(id, {
			id,
			name,
			width,
			height,
			fileDataType,
			fileData,
			...(hash == null ? {} : { hash }),
		});
	};
	visitVisualModuleResourceReferences(visualModule, definitions, reference => {
		if (reference.kind === 'asset') { addAsset(reference.id); return; }
		const player = availablePlayers.get(reference.id);
		if (player == null) throw new Error(`Missing Player: ${reference.id}`);
		players.set(player.id, {
			id: player.id,
			name: player.name,
			sourceType: player.sourceType,
			...(player.sourceType === 'asset' ? { assetId: player.assetId } : {}),
		});
		if (player.sourceType === 'asset' && player.assetId != null) addAsset(player.assetId);
	});
	return { visualModule, assets: [...assets.values()], players: [...players.values()] };
}
