import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { inspectStaticParameter, staticParameterShape, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { validateCustomNodeGraphEffectAudioBinding } from './audio-parameters.ts';
import { getNodeOutputs } from './node-outputs.ts';
import { validateCustomNodeGraphEffectCustomParameters } from './custom-parameters.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode } from './types.ts';

export function customNodeGraphEffectNodeStaticShape(node: CustomNodeGraphEffectNode, definitions: Readonly<Record<string, EffectDefinition>>): unknown {
	if (node.type !== 'effect') return node.type === 'relay' ? [node.type, node.input] : node.type === 'globalOut' ? [node.type, node.inputs] : node.type;
	return [node.effectId, node.resolution, node.staticSettings, Object.entries(node.params).map(([key, binding]) => [key, staticParameterShape(definitions[node.effectId]?.paramDefs[key], binding)])];
}

export function validateCustomNodeGraphEffectInterface(customNodeGraphEffect: CustomNodeGraphEffect): void {
	validateCustomNodeGraphEffectCustomParameters(customNodeGraphEffect);
	if (new Set(customNodeGraphEffect.nodes.map(node => node.id)).size !== customNodeGraphEffect.nodes.length) throw new Error('Duplicate node ID');
	if (new Set(customNodeGraphEffect.paramDefs.map(def => def.id)).size !== customNodeGraphEffect.paramDefs.length) throw new Error('Duplicate public parameter ID');
	if (new Set(customNodeGraphEffect.paramDefs.map(def => def.nameForReference)).size !== customNodeGraphEffect.paramDefs.length) throw new Error('Duplicate public parameter name');
	for (const definition of customNodeGraphEffect.paramDefs) validateParameterDefaultValues(definition);
	if (new Set(customNodeGraphEffect.outputDefs.map(def => def.id)).size !== customNodeGraphEffect.outputDefs.length) throw new Error('Duplicate output ID');
	if (customNodeGraphEffect.primaryInputId != null && !customNodeGraphEffect.paramDefs.some(def => def.id === customNodeGraphEffect.primaryInputId && def.canNode && def.dataType.kind === 'color')) throw new Error('Invalid primary image input');
	if (customNodeGraphEffect.primaryAudioInputId != null && !customNodeGraphEffect.paramDefs.some(def => def.id === customNodeGraphEffect.primaryAudioInputId && !def.canNode && def.dataType.kind === 'audioSource')) throw new Error('Invalid primary audio input');
	if (customNodeGraphEffect.primaryOutputId != null && !customNodeGraphEffect.outputDefs.some(def => def.id === customNodeGraphEffect.primaryOutputId)) throw new Error('Invalid primary output');
}

/** ノード単位の検査と同時に辺を抽出する。循環検査は呼び出し側が辺の変更時だけ行う。 */
export function inspectCustomNodeGraphEffectNode(node: CustomNodeGraphEffectNode, customNodeGraphEffect: CustomNodeGraphEffect,
	definitions: Readonly<Record<string, EffectDefinition>>, onConnection: (nodeId: string) => void,
	onValue: (definition: ParameterDefinition, binding: unknown) => void = () => {}): void {
	const connection = (reference: { nodeId: string | null; outputPort: string | null }) => {
		if (reference.nodeId == null) return;
		onConnection(reference.nodeId);
		const source = customNodeGraphEffect.nodes.find(source => source.id === reference.nodeId);
		if (!source) throw new Error('Referenced node not found: ' + reference.nodeId);
		const outputs = source.type === 'effect' ? definitions[source.effectId]?.outputDefs : getNodeOutputs(source, customNodeGraphEffect.paramDefs, definitions);
		if (reference.outputPort == null || !outputs?.[reference.outputPort]) throw new Error('Referenced output not found: ' + reference.outputPort);
	};
	if (node.type === 'relay') { connection(node.input); return; }
	if (node.type === 'globalOut') { for (const input of Object.values(node.inputs)) connection(input); return; }
	if (node.type !== 'effect') return;
	const definition = definitions[node.effectId];
	if (!definition) throw new Error('Effect not found: ' + node.effectId);
	validateEffectResolution(node.resolution);
	validateStaticSettings(definition.staticSettingDefs ?? {}, node.staticSettings ?? {});
	for (const [key, def] of Object.entries(definition.paramDefs)) {
		inspectStaticParameter(def, node.params[key], (leaf, binding) => {
			onValue(leaf, binding);
			validateCustomNodeGraphEffectAudioBinding(leaf, binding, customNodeGraphEffect.paramDefs);
			if (binding.inputSource === 'node') {
				if (!leaf.canNode) throw new Error('Parameter does not accept node input: ' + key);
				connection(binding);
			} else if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
				if (!customNodeGraphEffect.paramDefs.some(def => def.id === binding.parameterId)) throw new Error('Public parameter not found');
				const publicParameterDefinition = customNodeGraphEffect.paramDefs.find(def => def.id === binding.parameterId)!;
				if ((leaf.dataType.kind === 'colorRamp' || publicParameterDefinition.dataType.kind === 'colorRamp') && !areDataTypesEqual(leaf.dataType, publicParameterDefinition.dataType)) throw new Error('Color Ramp public parameter type mismatch');
			} else if (binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference') {
				// 欠落・型変更は参照を消さず、実際に評価されたときに所在付きで報告する。
				if (typeof binding.parameterId !== 'string') throw new Error('Invalid custom parameter reference');
			} else if (!isValueParameterBinding(binding)) throw new Error('Unsupported Custom Node Graph Effect parameter input source');
		});
	}
}
