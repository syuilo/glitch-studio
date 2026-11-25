import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { canCoerceParameterDataType } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { validateCustomShaderEffectDefinition } from './custom-shader-effect.ts';
import { validateEffectResolution } from './resolution.ts';
import { validateEffectParameterLayout } from './effect-parameter-layout.ts';
import { canConnectNodeDataTypes, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import { resolveEffectSource } from './effect-source.ts';
import type { EffectDefinitions, EffectSource, ResolvedEffect } from './effect-source.ts';
import type { EffectDefinition } from './effect-definition.ts';
import { isUnselectedNodesEffectParameterReference, type NodesEffect, type NodesEffectParameterBinding, type NodesEffectOutputSource, type NodeOutputReference } from './nodes-effect.ts';

type InputSettings = { canNode?: boolean; element?: InputSettings; fields?: Record<string, InputSettings> };

/** 参照先の欠落は静的検証で報告し、描画中の定義解決にはこの診断を持ち込まない。 */
export function resolveEffectSourceForValidation(source: EffectSource, definitions: EffectDefinitions): ResolvedEffect {
	const effect = resolveEffectSource(source, definitions);
	if (effect.definition == null) {
		const kind = effect.type === 'nativeEffect' ? 'Native Effect' : effect.type === 'customShaderEffect' ? 'Custom Shader Effect' : 'Nodes Effect';
		throw new Error('Unknown ' + kind + ': ' + ('id' in source ? source.id : 'inline'));
	}
	return effect;
}

export function acceptsResolutionInput(settings: InputSettings | undefined): boolean {
	if (settings == null) return false;
	return settings.canNode === true || (settings.element != null && acceptsResolutionInput(settings.element))
		|| (settings.fields != null && Object.values(settings.fields).some(acceptsResolutionInput));
}

/** 編集・読み込み時に使う。未使用ポートやバイパスを含む保存グラフを検証し、描画側は再検査しない。 */
export function validateEffectSource(source: EffectSource, definitions: EffectDefinitions): void {
	const validated = new Set<object>();
	const ancestors = new Set<NodesEffect>();
	const ancestorIds = new Set<string>();

	function visit(source: EffectSource): EffectDefinition {
		const effect = resolveEffectSourceForValidation(source, definitions);
		if (effect.type === 'nativeEffect' || validated.has(effect.definition)) return effect.definition;
		if (effect.definition.ui != null) validateEffectParameterLayout(effect.definition.ui.parameterLayout, Object.keys(effect.definition.paramDefs));
		validateStaticSettings(effect.definition.staticSettingDefs ?? {}, {});
		const intrinsic = effect.definition.intrinsicResolutionSetting;
		if (intrinsic != null) {
			const type = effect.definition.staticSettingDefs?.[intrinsic]?.dataType;
			if (type?.kind !== 'assetReference' || (type.assetType !== 'image' && type.assetType !== 'video')) {
				throw new Error('Invalid intrinsic resolution setting: ' + intrinsic);
			}
		}
		if (effect.type === 'customShaderEffect') validateCustomShaderEffectDefinition(effect.definition);
		if (effect.type === 'nodesEffect') {
			const nodesEffect = effect.definition;
			for (const parameter of Object.values(nodesEffect.paramDefs)) validateParameterDefaultValues(parameter);
			const registeredId = source.type === 'nodesEffectReference' ? source.id : null;
			if (ancestors.has(nodesEffect) || (registeredId != null && ancestorIds.has(registeredId))) throw new Error('Cyclic Nodes Effect reference');
			if (registeredId != null) ancestorIds.add(registeredId);
			ancestors.add(nodesEffect);
			const nodes = new Map(nodesEffect.nodes.map(node => [node.id, node]));
			if (nodes.size !== nodesEffect.nodes.length) throw new Error('Duplicate Nodes Effect node ID');
			const nodeDefinitions = new Map(nodesEffect.nodes.filter(node => node.type !== 'relay').map(node => [node.id, visit(node.effectSource)]));
			const complete = new Set<string>();
			const path = new Set<string>();

			function checkOutput(reference: NodeOutputReference): TextureDataType {
				const node = nodes.get(reference.nodeId);
				const output = node?.type === 'relay' && reference.outputPort === 'output' ? node : nodeDefinitions.get(reference.nodeId)?.outputDefs[reference.outputPort];
				if (output == null) throw new Error('Unknown node output: ' + reference.nodeId + '.' + reference.outputPort);
				checkNode(reference.nodeId);
				return output.dataType;
			}

			function sourceType(source: NodesEffectOutputSource): TextureDataType | null {
				if ('nodeId' in source) return checkOutput(source);
				const def = nodesEffect.paramDefs[source.parameterId];
				return def == null ? null : getNodeInputDataType(def);
			}

			// 型安全設定は新しい配線を作るときに使う。保存済みの配線は、両端が画像ポートなら
			// 設定の切り替え後や別の環境で開いた場合も、同じデータを描画できる。
			function checkNode(id: string): void {
				if (complete.has(id)) return;
				if (path.has(id)) throw new Error('Cyclic node connection: ' + [...path, id].join(' → '));
				path.add(id);
				const node = nodes.get(id)!;
				if (node.type === 'relay') {
					if (node.input != null && !canConnectNodeDataTypes(sourceType(node.input), node.dataType, 'allowMismatch')) throw new Error('Incompatible relay: ' + id);
				} else {
					const definition = nodeDefinitions.get(id)!;
					validateStaticSettings(definition.staticSettingDefs ?? {}, node.staticSettings ?? {});
					if (node.resolution != null) validateEffectResolution('mode' in node.resolution ? node.resolution : { mode: 'customAbsolute', ...node.resolution });
					for (const [key, binding] of Object.entries(node.params)) checkBinding(id, key, binding);
				}
				path.delete(id);
				complete.add(id);
			}

			function checkBinding(id: string | null, key: string, binding: NodesEffectParameterBinding): void {
				const parameter = id == null ? nodesEffect.customParameterDefs?.[key] : nodeDefinitions.get(id)!.paramDefs[key];
				if (parameter == null) throw new Error('Unknown node parameter: ' + id + '.' + key);
				inspectStaticParameter<NodesEffectParameterBinding>(parameter, binding, (def, leaf) => {
					if (isUnselectedNodesEffectParameterReference(leaf)) return;
					if (!isValueParameterBinding(leaf) && leaf.inputSource !== 'node' && leaf.inputSource !== 'nodesEffectCustomParameterValueReference'
						&& leaf.inputSource !== 'nodesEffectPublicParameterReference') throw new Error('Unsupported parameter binding: ' + key);
					if (leaf.inputSource === 'node' && (def.canNode !== true || id == null)) throw new Error('Parameter does not accept node input: ' + key);
					if (leaf.inputSource === 'nodesEffectCustomParameterValueReference') {
						const source = nodesEffect.customParameterDefs?.[leaf.parameterId];
						if (source == null || !areDataTypesEqual(source.dataType, def.dataType)) throw new Error('Incompatible custom parameter: ' + key);
					}
					// 音声の取得元は固定値または同じ型の公開パラメータ参照で指定する。式とは独立に解決する。
					if (def.dataType.kind === 'audioSource' && leaf.inputSource !== 'nodesEffectPublicParameterReference') validateLiteralAudioSourceBinding(leaf);
					if (leaf.inputSource === 'node' && leaf.source != null) {
						if (!canConnectNodeDataTypes(checkOutput(leaf.source), getNodeInputDataType(def), 'allowMismatch')) throw new Error('Incompatible node connection: ' + key);
					}
					if (leaf.inputSource === 'nodesEffectPublicParameterReference') {
						const parameter = nodesEffect.paramDefs[leaf.parameterId];
						if (parameter == null) throw new Error('Unknown public parameter: ' + leaf.parameterId);
						if (id == null && parameter.canNode === true) throw new Error('Custom parameters require CPU values: ' + key);
						const compatible = parameter.canNode === true
							? canConnectNodeDataTypes(getNodeInputDataType(parameter), getNodeInputDataType(def), 'allowMismatch')
							: areDataTypesEqual(parameter.dataType, def.dataType)
								|| (id != null && canCoerceParameterDataType(parameter.dataType, def.dataType));
						if (!compatible) throw new Error('Incompatible public parameter: ' + key);
					}
				});
			}

			for (const id of nodes.keys()) checkNode(id);
			const names = Object.entries(nodesEffect.paramDefs).map(([id, def]) => def.nameForReference ?? id);
			const custom = Object.values(nodesEffect.customParameterDefs ?? {});
			const unique = (values: string[]) => !values.includes('') && new Set(values).size === values.length;
			if (!unique(names) || !unique(custom.map(def => def.nameForReference))) throw new Error('Invalid parameter reference name');
			const nodesEffects = nodesEffect.curveAnimations ?? [];
			if (!unique(nodesEffects.map(g => g.id)) || !unique(nodesEffects.map(g => g.nameForReference))) throw new Error('Invalid Curve Animation reference');
			for (const def of custom) {
				if (def.canNode != null && def.canNode !== false) throw new Error('Custom parameters require CPU values');
				if (!['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'].includes(def.dataType.kind)) throw new Error('Unsupported custom parameter type');
				validateParameterDefaultValues(def);
			}
			const checkedCustom = new Set<string>();
			const checkingCustom = new Set<string>();

			function checkCustom(key: string) {
				if (checkedCustom.has(key)) return;
				if (checkingCustom.has(key)) throw new Error('Circular custom parameter reference: ' + [...checkingCustom, key].join(' → '));
				checkingCustom.add(key);
				const binding = nodesEffect.customParameterValues?.[key];
				if (binding != null) {
					checkBinding(null, key, binding);
					if (binding.inputSource === 'nodesEffectCustomParameterValueReference' && binding.parameterId !== '') checkCustom(binding.parameterId);
				}
				checkingCustom.delete(key);
				checkedCustom.add(key);
			}

			for (const key of Object.keys(nodesEffect.customParameterValues ?? {})) checkCustom(key);
			if (nodesEffect.primaryInputParameter != null && nodesEffect.paramDefs[nodesEffect.primaryInputParameter]?.canNode !== true) throw new Error('Invalid primary input');
			if (nodesEffect.primaryOutput != null && nodesEffect.outputDefs[nodesEffect.primaryOutput] == null) throw new Error('Invalid primary output');
			if (nodesEffect.primaryAudioInputParameter != null && nodesEffect.paramDefs[nodesEffect.primaryAudioInputParameter]?.dataType.kind !== 'audioSource') throw new Error('Invalid primary audio input');
			if (nodesEffect.resolutionInputParameters.some(key => !acceptsResolutionInput(nodesEffect.paramDefs[key]))) throw new Error('Invalid resolution input');
			for (const [id, output] of Object.entries(nodesEffect.outputSources)) {
				if (output == null) continue;
				if (!canConnectNodeDataTypes(sourceType(output), nodesEffect.outputDefs[id]?.dataType, 'allowMismatch')) throw new Error('Incompatible public output: ' + id);
			}
			ancestors.delete(nodesEffect);
			if (registeredId != null) ancestorIds.delete(registeredId);
		}
		validated.add(effect.definition);
		return effect.definition;
	}

	visit(source);
}
