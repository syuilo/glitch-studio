import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';

type EffectDefinitions = Readonly<Record<string, Pick<EffectDefinition, 'paramDefs'>>>;

export type VisualModuleFile = {
	kind: 'glitch-studio-visual-module';
	formatVersion: 1;
	gsVersion: string;
	name: string;
	visualModule: VisualModule;
	assets: Asset[];
	players: Player[];
};

export type VisualModuleImport = {
	visualModule: ProjectVisualModule;
	assets: ProjectAsset[];
	players: Player[];
	unassignedPlayerNames: string[];
};

type ResourceReference = { kind: 'asset' | 'player'; id: string };

function getResourceReference(def: ParameterDefinition, binding: VisualModuleParameterBinding): ResourceReference | null {
	const kind = def.dataType.kind;
	if (!['assetReference', 'videoAssetReference', 'fontAssetReference', 'playerReference', 'audioSource'].includes(kind)) return null;
	if (binding.inputSource === 'externalCustomParameterInput') return null;
	// 式の実行結果や文字列内のIDからは、必要な素材を列挙したり参照を安全に書き換えたりできない。
	// 動的な参照を黙って失うより、公開パラメータ経由の静的な指定へ変更してもらう。
	if (binding.inputSource !== 'literal') {
		throw new Error(`Cannot transfer "${def.ui.label}": Asset and Player references must use a fixed value or a Custom Parameter.`);
	}
	if (binding.value === null) return null;
	if (kind === 'audioSource') {
		validatePlayerAudioSourceSelection(binding.value);
		if (binding.value === null) return null;
		return { kind: 'player', id: binding.value.playerId };
	}
	if (typeof binding.value !== 'string' || !binding.value) throw new Error(`Invalid resource reference: ${def.ui.label}`);
	return { kind: kind === 'playerReference' ? 'player' : 'asset', id: binding.value };
}

function visitResourceBindings(visualModule: VisualModule, definitions: EffectDefinitions,
	visit: (def: ParameterDefinition, binding: VisualModuleParameterBinding, reference: ResourceReference) => void) {
	const visitBindings = (defs: Record<string, ParameterDefinition>, bindings: Record<string, VisualModuleParameterBinding>) => {
		for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(defs, bindings)) {
			if (param == null || typeof param.inputSource !== 'string') throw new Error('Invalid Visual Module parameter.');
			const reference = getResourceReference(def, param);
			if (reference != null) visit(def, param, reference);
		}
	};
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		const definition = definitions[node.effectId];
		if (!definition) throw new Error(`Unknown effect: ${node.effectId}`);
		visitBindings(definition.paramDefs, node.params);
	}
	const visitDefinition = (def: ParameterDefinition) => {
		visitBindings({ default: def }, { default: def.defaultValue });
		// 配列全体が空でも、後から要素を追加するときの既定値は素材に依存し得る。
		// 現在の値のツリーとは別に、公開パラメータ定義の設定ツリーもたどる。
		if (def.dataType.kind === 'array') visitDefinition(getArrayElementDefinition(def));
		else if (def.dataType.kind === 'struct') for (const field of Object.values(getStructFieldDefinitions(def))) visitDefinition(field);
	};
	for (const def of visualModule.paramDefs) visitDefinition(def);
}

function indexResources<T extends { id: string }>(resources: T[]): Map<string, T> {
	const indexed = new Map(resources.map(resource => [resource.id, resource]));
	if (indexed.size !== resources.length) throw new Error('Duplicate resource IDs in the Visual Module file.');
	return indexed;
}

export function collectVisualModuleFile(input: {
	name: string; gsVersion: string; visualModule: VisualModule; assets: Asset[]; players: Player[];
}, definitions: EffectDefinitions): VisualModuleFile {
	// ProjectVisualModuleやインラインのレイヤーから渡されても、所属先のID・設定はファイルへ持ち込まない。
	const { nodes, paramDefs, outputDefs, primaryInputId, primaryOutputId, primaryAudioInputId, automationGraphs } = input.visualModule;
	const visualModule = deepClone({ nodes, paramDefs, outputDefs, primaryInputId, primaryOutputId, primaryAudioInputId, automationGraphs });
	const availableAssets = indexResources(input.assets);
	const availablePlayers = indexResources(input.players);
	const assets = new Map<string, Asset>();
	const players = new Map<string, Player>();
	const addAsset = (id: string) => {
		const asset = availableAssets.get(id);
		if (!asset) throw new Error(`Missing Asset: ${id}`);
		// 元ファイルの絶対パスなど、取り込み元PC固有の情報は同梱しない。
		const { name, width, height, fileDataType, fileData, hash } = asset;
		assets.set(id, { id, name, width, height, fileDataType, fileData, ...(hash === undefined ? {} : { hash }) });
	};
	visitResourceBindings(visualModule, definitions, (_def, _binding, reference) => {
		if (reference.kind === 'asset') { addAsset(reference.id); return; }
		const player = availablePlayers.get(reference.id);
		if (!player) throw new Error(`Missing Player: ${reference.id}`);
		players.set(player.id, {
			id: player.id, name: player.name, sourceType: player.sourceType,
			...(player.sourceType === 'asset' ? { assetId: player.assetId } : {}),
		});
		if (player.sourceType === 'asset' && player.assetId != null) addAsset(player.assetId);
	});
	return {
		kind: 'glitch-studio-visual-module', formatVersion: 1, gsVersion: input.gsVersion, name: input.name,
		visualModule, assets: [...assets.values()], players: [...players.values()],
	};
}

export async function encodeVisualModuleFile(file: VisualModuleFile): Promise<Uint8Array> {
	const assets = await Promise.all(file.assets.map(async asset => {
		try {
			return { ...asset, fileData: new Uint8Array(await asset.fileData.arrayBuffer()) };
		} catch (cause) {
			throw new Error(`Could not read Asset "${asset.name}". Replace it with the source file and try exporting again.`, { cause });
		}
	}));
	return msgpack.encode({ ...file, assets });
}

export function decodeVisualModuleFile(data: Uint8Array, currentVersion: string): VisualModuleFile {
	const file = msgpack.decode(data) as Omit<VisualModuleFile, 'assets'> & {
		assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
	};
	if (file?.kind !== 'glitch-studio-visual-module' || file.formatVersion !== 1
		|| typeof file.name !== 'string' || typeof file.gsVersion !== 'string'
		|| !Array.isArray(file.assets) || !Array.isArray(file.players)
		|| !Array.isArray(file.visualModule?.nodes) || !Array.isArray(file.visualModule.paramDefs)
		|| !Array.isArray(file.visualModule.outputDefs) || !Array.isArray(file.visualModule.automationGraphs)) {
		throw new Error('Unsupported Visual Module file.');
	}
	if (semverGt(file.gsVersion, currentVersion)) throw new Error(`This Visual Module requires a newer version of Glitch Studio (${file.gsVersion}).`);
	return { ...file, assets: file.assets.map(asset => {
		if (!(asset.fileData instanceof Uint8Array)) throw new Error(`Invalid Asset data: ${asset.name}`);
		return { ...asset, fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }) };
	}) };
}

export function prepareVisualModuleImport(file: VisualModuleFile, definitions: EffectDefinitions, createId = genId): VisualModuleImport {
	// 読み込み成立に必要なエフェクト・素材・Playerの参照を、プロジェクトを変更する前に解決する。
	const collected = collectVisualModuleFile(file, definitions);
	const assetIds = new Map(collected.assets.map(asset => [asset.id, createId()]));
	const playerIds = new Map(collected.players.map(player => [player.id, createId()]));
	visitResourceBindings(collected.visualModule, definitions, (def, binding, reference) => {
		if (binding.inputSource !== 'literal') return;
		const id = (reference.kind === 'asset' ? assetIds : playerIds).get(reference.id)!;
		binding.value = def.dataType.kind === 'audioSource' ? { type: 'player', playerId: id } : id;
	});
	const unassignedPlayerNames: string[] = [];
	const players = collected.players.map(player => {
		const id = playerIds.get(player.id)!;
		if (player.sourceType === 'asset') return { ...player, id, assetId: player.assetId == null ? null : assetIds.get(player.assetId)! };
		// マイクやカメラは別PCで同じ入力を再現できず、自動起動も行わない。
		// Playerへの配線は新しいIDで維持し、取り込み後に入力だけを選び直せるようにする。
		if (player.sourceType != null) unassignedPlayerNames.push(player.name);
		return { id, name: player.name, sourceType: null };
	});
	return {
		visualModule: { ...collected.visualModule, id: createId(), name: collected.name },
		assets: collected.assets.map(asset => ({ ...asset, id: assetIds.get(asset.id)!, sourceFilePath: null })),
		players, unassignedPlayerNames,
	};
}
