import { inspectEffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import { inspectParameterTree, inspectValueBinding } from '@gs/shared/parameter/static-parameter-validation.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleNode } from './types.ts';
import { inspectVisualModuleAudioBinding } from './audio-parameters.ts';
import type { VisualModuleParameterBinding } from './types.ts';

export function inspectVisualModuleContract(visualModule: VisualModule): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	for (const definitions of [visualModule.paramDefs, visualModule.outputDefs]) {
		if (new Set(definitions.map(def => def.id)).size !== definitions.length) diagnostics.push({ code: 'visualModule.duplicateId', message: 'Duplicate Visual Module port ID' });
	}
	const primary = visualModule.paramDefs.find(def => def.id === visualModule.primaryInputId);
	if (visualModule.primaryInputId != null && (!primary?.canNode || primary.dataType.kind !== 'color')) diagnostics.push({ code: 'visualModule.primaryInput', message: 'Primary input must reference a node-capable color parameter' });
	if (visualModule.primaryOutputId != null && !visualModule.outputDefs.some(def => def.id === visualModule.primaryOutputId && def.dataType?.kind === 'color')) diagnostics.push({ code: 'visualModule.primaryOutput', message: 'Primary output must reference a color output' });
	if (visualModule.primaryAudioInputId != null && !visualModule.paramDefs.some(def => def.id === visualModule.primaryAudioInputId && def.dataType.kind === 'audioSource' && !def.canNode)) diagnostics.push({ code: 'visualModule.primaryAudioInput', message: 'Invalid primary audio input' });
	for (const def of visualModule.paramDefs) diagnostics.push(...inspectParameterTree(def, def.defaultValue, inspectValueBinding, [def.id]));
	return diagnostics;
}

export function inspectVisualModuleNode(node: VisualModuleNode, visualModule: VisualModule, effectDefinitions: Readonly<Record<string, EffectDefinition>>, inspectAudioSource: (value: unknown) => readonly ValidationDiagnostic[] = () => []): { diagnostics: ValidationDiagnostic[]; references: string[] } {
	const diagnostics: ValidationDiagnostic[] = [];
	const references: string[] = [];
	const reference = (binding: { nodeId: string | null }) => { if (binding.nodeId != null) references.push(binding.nodeId); };
	if (node.type === 'relay') reference(node.input);
	else if (node.type === 'globalOut') Object.values(node.inputs).forEach(reference);
	else if (node.type === 'effect') {
		const definition = effectDefinitions[node.effectId];
		if (!definition) return { diagnostics: [{ code: 'effect.missing', message: `Effect not found: ${node.effectId}` }], references };
		diagnostics.push(...inspectEffectResolution(node.resolution));
		// バイパス・未使用ポートに関係なく保存された配線を検証する。
		// 有効化時に検証結果が変わらず、描画対象の探索を検証側へ持ち込まない。
		for (const [key, def] of Object.entries(definition.paramDefs)) {
			diagnostics.push(...inspectParameterTree(def, node.params[key], (leaf, binding, path) => {
				const audioDiagnostics = inspectVisualModuleAudioBinding(leaf, binding as VisualModuleParameterBinding, visualModule.paramDefs);
				if (audioDiagnostics.length) return audioDiagnostics.map(diagnostic => ({ ...diagnostic, path }));
				if (binding.inputSource === 'node') {
					reference(binding as { nodeId: string | null });
					return leaf.canNode ? [] : [{ code: 'parameter.node', message: 'Parameter cannot accept node input', path }];
				}
				if (binding.inputSource === 'externalCustomParameterInput') {
					const source = visualModule.paramDefs.find(source => source.id === binding.parameterId);
					if (!source) return [{ code: 'parameter.reference', message: 'Referenced custom parameter not found', path }];
					return [];
				}
				if (leaf.dataType.kind === 'audioSource') return inspectAudioSource(binding.value).map(diagnostic => ({ ...diagnostic, path }));
				return inspectValueBinding(leaf, binding, path);
			}, [key]));
		}
	}
	return { diagnostics, references: [...new Set(references)].sort() };
}
