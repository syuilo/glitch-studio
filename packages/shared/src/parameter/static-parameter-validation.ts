import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter-definition.ts';
import { isValueParameterBinding } from './parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ParameterBindingBase } from './parameter-binding.ts';
import type { ValidationDiagnostic } from '../validation/diagnostic.ts';

export type StaticParameterLeafInspector = (definition: ParameterDefinition, binding: Record<string, any>, path: readonly (string | number)[]) => readonly ValidationDiagnostic[];

export function inspectStaticValue(definition: ParameterDefinition, value: unknown, path: readonly (string | number)[]): ValidationDiagnostic[] {
	const kind = definition.dataType.kind;
	if (kind === 'enum' && (typeof value !== 'string' || !definition.dataType.options.includes(value))) {
		return [{ code: 'parameter.enum', message: `Invalid enum value for ${definition.ui.label}`, path }];
	}
	if (kind === 'scalar' && (typeof value === 'string' ? value.trim() === '' || !Number.isFinite(Number(value)) : typeof value !== 'number' || !Number.isFinite(value))) {
		return [{ code: 'parameter.scalar', message: `Expected a finite number for ${definition.ui.label}`, path }];
	}
	return [];
}

export function inspectValueBinding(definition: ParameterDefinition, binding: Record<string, any>, path: readonly (string | number)[]): ValidationDiagnostic[] {
	if (!isValueParameterBinding(binding as ParameterBindingBase)) return [{ code: 'parameter.source', message: `Unsupported parameter input source: ${binding.inputSource}`, path }];
	if (binding.inputSource === 'literal') return inspectStaticValue(definition, binding.value, path);
	if (binding.inputSource === 'keyframesTimelineInline') {
		return (binding.keyframesTimeline?.keyframes ?? []).flatMap((point: { value: unknown }, index: number) => inspectStaticValue(definition, point.value, [...path, index]));
	}
	return [];
}

/** 子のBindingまで検査し、壊れたコンテナの先へは進まない。描画用のツリー走査とは分離する。 */
export function inspectParameterTree(definition: ParameterDefinition, value: unknown, inspectLeaf: StaticParameterLeafInspector, path: readonly (string | number)[] = []): ValidationDiagnostic[] {
	if (value == null || typeof value !== 'object' || !('inputSource' in value)) return [{ code: 'parameter.binding', message: 'Parameter binding is required', path }];
	const binding = value as Record<string, any>;
	if (definition.dataType.kind !== 'array' && definition.dataType.kind !== 'struct') return [...inspectLeaf(definition, binding, path)];
	if (binding.inputSource !== 'literal') return [{ code: 'parameter.container', message: 'Container parameter must be literal', path }];
	if (definition.dataType.kind === 'array') {
		if (!Array.isArray(binding.value)) return [{ code: 'parameter.array', message: 'Expected array parameter', path }];
		const diagnostics: ValidationDiagnostic[] = [];
		const ids = new Set<string>();
		for (const [index, element] of binding.value.entries()) {
			if (!element || typeof element.id !== 'string' || ids.has(element.id)) diagnostics.push({ code: 'parameter.elementId', message: 'Invalid or duplicate array element ID', path: [...path, index] });
			ids.add(element?.id);
			diagnostics.push(...inspectParameterTree(getArrayElementDefinition(definition), element?.binding, inspectLeaf, [...path, index]));
		}
		return diagnostics;
	}
	if (!binding.value || typeof binding.value !== 'object' || Array.isArray(binding.value)) return [{ code: 'parameter.struct', message: 'Expected struct parameter', path }];
	return Object.entries(getStructFieldDefinitions(definition)).flatMap(([key, field]) => inspectParameterTree(field, binding.value[key], inspectLeaf, [...path, key]));
}

