import { inspectStaticParameter, staticParameterShape, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { validateVisualModuleAudioBinding } from './audio-parameters.ts';
import { getNodeOutputs } from './node-outputs.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModule, VisualModuleNode } from './types.ts';

export function visualModuleNodeStaticShape(node: VisualModuleNode, definitions: Readonly<Record<string, EffectDefinition>>): unknown {
	if (node.type !== 'effect') return node.type === 'relay' ? [node.type, node.input] : node.type === 'globalOut' ? [node.type, node.inputs] : node.type;
	return [node.effectId, node.resolution, Object.entries(node.params).map(([key, binding]) => [key, staticParameterShape(definitions[node.effectId]?.paramDefs[key], binding)])];
}

export function validateVisualModuleInterface(visualModule: VisualModule): void {
	if (new Set(visualModule.nodes.map(node => node.id)).size !== visualModule.nodes.length) throw new Error('Duplicate node ID');
	if (new Set(visualModule.paramDefs.map(def => def.id)).size !== visualModule.paramDefs.length) throw new Error('Duplicate custom parameter ID');
	for (const definition of visualModule.paramDefs) validateParameterDefaultValues(definition);
	if (new Set(visualModule.outputDefs.map(def => def.id)).size !== visualModule.outputDefs.length) throw new Error('Duplicate output ID');
	if (visualModule.primaryInputId != null && !visualModule.paramDefs.some(def => def.id === visualModule.primaryInputId && def.canNode && def.dataType.kind === 'color')) throw new Error('Invalid primary image input');
	if (visualModule.primaryAudioInputId != null && !visualModule.paramDefs.some(def => def.id === visualModule.primaryAudioInputId && !def.canNode && def.dataType.kind === 'audioSource')) throw new Error('Invalid primary audio input');
	if (visualModule.primaryOutputId != null && !visualModule.outputDefs.some(def => def.id === visualModule.primaryOutputId)) throw new Error('Invalid primary output');
}

/** ノード単位の検査と同時に辺を抽出する。循環検査は呼び出し側が辺の変更時だけ行う。 */
export function inspectVisualModuleNode(node: VisualModuleNode, visualModule: VisualModule,
	definitions: Readonly<Record<string, EffectDefinition>>, onConnection: (nodeId: string) => void,
	onValue: (definition: ParameterDefinition, binding: unknown) => void = () => {}): void {
	const connection = (reference: { nodeId: string | null; outputPort: string | null }) => {
		if (reference.nodeId == null) return;
		onConnection(reference.nodeId);
		const source = visualModule.nodes.find(source => source.id === reference.nodeId);
		if (!source) throw new Error('Referenced node not found: ' + reference.nodeId);
		const outputs = source.type === 'effect' ? definitions[source.effectId]?.outputDefs : getNodeOutputs(source, visualModule.paramDefs);
		if (reference.outputPort == null || !outputs?.[reference.outputPort]) throw new Error('Referenced output not found: ' + reference.outputPort);
	};
	if (node.type === 'relay') { connection(node.input); return; }
	if (node.type === 'globalOut') { for (const input of Object.values(node.inputs)) connection(input); return; }
	if (node.type !== 'effect') return;
	const definition = definitions[node.effectId];
	if (!definition) throw new Error('Effect not found: ' + node.effectId);
	validateEffectResolution(node.resolution);
	for (const [key, def] of Object.entries(definition.paramDefs)) {
		inspectStaticParameter(def, node.params[key], (leaf, binding) => {
			onValue(leaf, binding);
			validateVisualModuleAudioBinding(leaf, binding, visualModule.paramDefs);
			if (binding.inputSource === 'node') {
				if (!leaf.canNode) throw new Error('Parameter does not accept node input: ' + key);
				connection(binding);
			} else if (binding.inputSource === 'externalCustomParameterInput') {
				if (!visualModule.paramDefs.some(def => def.id === binding.parameterId)) throw new Error('Custom parameter not found');
				const customDefinition = visualModule.paramDefs.find(def => def.id === binding.parameterId)!;
				if ((leaf.dataType.kind === 'colorRamp' || customDefinition.dataType.kind === 'colorRamp') && !areDataTypesEqual(leaf.dataType, customDefinition.dataType)) throw new Error('Color Ramp custom parameter type mismatch');
			} else if (!isValueParameterBinding(binding)) throw new Error('Unsupported visual module parameter input source');
		});
	}
}
