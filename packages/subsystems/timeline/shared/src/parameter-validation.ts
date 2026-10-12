import { inspectParameterTree, inspectValueBinding } from '@gs/shared/parameter/static-parameter-validation.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';

export function inspectTimelineBindingSource(value: unknown, allowLayerInput = false, allowAudioInput = allowLayerInput, path: readonly (string | number)[] = []): ValidationDiagnostic[] {
	const error = (message: string): ValidationDiagnostic[] => [{ code: 'timeline.binding', message, path }];
	if (!value || typeof value !== 'object') return error('Parameter binding is required');
	const binding = value as Record<string, any>;
	if (binding.inputSource === 'layerInput') {
		if (!allowLayerInput) return error('Layer input is only available in effect layer parameters');
		return ['cover', 'contain', 'stretch'].includes(binding.fitMode) && ['clamp', 'repeat', 'repeatMirrored', 'transparent'].includes(binding.wrapMode) && ['linear', 'nearest'].includes(binding.filterMode) ? [] : error('Invalid layer input sampling');
	}
	if (binding.inputSource === 'lowerLayerAudio' || binding.inputSource === 'layerAudio') {
		if (!allowAudioInput) return error('Layer audio is not available in this parameter');
		return binding.inputSource === 'layerAudio' && binding.layerId !== null && (typeof binding.layerId !== 'string' || !binding.layerId) ? error('Invalid audio layer reference') : [];
	}
	if (!isValueParameterBinding(binding as ParameterBindingBase)) return error('Unsupported layer parameter input source');
	const diagnostics: ValidationDiagnostic[] = [];
	if ((binding.inputSource === 'automationGraphInline' || binding.inputSource === 'automationGraphReference') && binding.offsetMode !== 'start') diagnostics.push(...error('Layer automation graphs must use the scene start'));
	if (binding.inputSource === 'keyframesTimelineInline') {
		if (binding.keyframesTimeline?.isNormalized || binding.offsetMode !== 'start' || binding.wrapMode !== 'clamp' || binding.trimmedDurationMs != null) diagnostics.push(...error('Timeline keyframes must use absolute scene time without wrapping'));
		if (binding.keyframesTimeline?.keyframes.some((point: { x: number }) => !Number.isSafeInteger(point.x) || point.x < 0)) diagnostics.push(...error('Timeline keyframes must use non-negative integer milliseconds'));
	}
	return diagnostics;
}

export function inspectTimelineBinding(definition: ParameterDefinition, binding: Record<string, any>, path: readonly (string | number)[], allowLayerInput = false, allowAudioInput = false): ValidationDiagnostic[] {
	const diagnostics = inspectTimelineBindingSource(binding, allowLayerInput && definition.canNode === true, allowAudioInput && definition.dataType.kind === 'audioSource', path);
	if (diagnostics.length || binding.inputSource === 'layerInput' || binding.inputSource === 'lowerLayerAudio' || binding.inputSource === 'layerAudio') return diagnostics;
	if (definition.dataType.kind === 'audioSource') return binding.inputSource === 'literal' && binding.value === null ? [] : [{ code: 'timeline.audio', message: 'Timeline audio literals must be unselected', path }];
	return inspectValueBinding(definition, binding, path);
}

export function inspectTimelineParameters(definitions: Readonly<Record<string, ParameterDefinition>>, values: Readonly<Record<string, unknown>>, allowLayerInput = false, allowAudioInput = false, label = 'parameter'): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	for (const key of Object.keys(values)) if (!Object.hasOwn(definitions, key)) diagnostics.push({ code: 'parameter.unknown', message: `Unknown ${label}: ${key}`, path: [key] });
	for (const [key, definition] of Object.entries(definitions)) diagnostics.push(...inspectParameterTree(definition, values[key] ?? definition.defaultValue,
		(def, binding, path) => inspectTimelineBinding(def, binding, path, allowLayerInput, allowAudioInput), [key]));
	return diagnostics;
}

