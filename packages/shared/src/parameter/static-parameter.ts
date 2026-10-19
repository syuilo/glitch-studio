import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter-definition.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ParameterBindingBase, ParameterArrayElement } from './parameter-binding.ts';

/** 値の妥当性は評価後に検査する。ここではBindingの構造と静的な参照だけを扱う。 */
export function inspectStaticParameter<Binding extends ParameterBindingBase>(definition: ParameterDefinition, binding: Binding,
	inspectLeaf: (definition: ParameterDefinition, binding: Binding) => void): void {
	if (!binding) throw new Error('Missing parameter binding');
	if (definition.dataType.kind !== 'array' && definition.dataType.kind !== 'struct') {
		inspectLeaf(definition, binding);
		return;
	}
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Container parameter must be literal');
	if (definition.dataType.kind === 'array') {
		if (!Array.isArray(binding.value)) throw new Error('Expected array parameter');
		const elements = binding.value as ParameterArrayElement<Binding>[];
		if (new Set(elements.map(element => element.id)).size !== elements.length) throw new Error('Duplicate array element ID');
		for (const element of elements) inspectStaticParameter(getArrayElementDefinition(definition), element.binding, inspectLeaf);
	} else {
		const fields = binding.value as Record<string, Binding>;
		if (fields == null || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Expected struct parameter');
		const definitions = getStructFieldDefinitions(definition);
		if (Object.keys(fields).some(key => !Object.hasOwn(definitions, key))) throw new Error('Unknown struct field');
		for (const [key, field] of Object.entries(definitions)) inspectStaticParameter(field, fields[key], inspectLeaf);
	}
}

/**
 * 通常のliteral値や式本文を検証キャッシュのキーに含めない。
 * 参照・入力方式・配列構造・キーの配置は静的制約を変えるため、同じ「値編集」でも含める。
 */
// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function staticParameterShape(definition: ParameterDefinition | null | undefined, binding: any): unknown {
	if (!binding) return null;
	if (binding.inputSource === 'literal') {
		if (definition?.dataType.kind === 'array' && Array.isArray(binding.value)) {
			return ['array', binding.value.map((element: ParameterArrayElement) => [element.id, staticParameterShape(getArrayElementDefinition(definition), element.binding)])];
		}
		if (definition?.dataType.kind === 'struct' && binding.value && typeof binding.value === 'object') {
			const fields = getStructFieldDefinitions(definition);
			return ['struct', Object.entries(binding.value).map(([key, value]) => [key, staticParameterShape(fields[key], value)])];
		}
		const kind = definition?.dataType.kind;
		return ['literal', kind != null && ['imageAssetTextureReference', 'assetReference', 'playerReference', 'audioSource', 'array', 'struct'].includes(kind) ? binding.value : null];
	}
	if (binding.inputSource === 'expression') return ['expression'];
	if (binding.inputSource === 'automationGraphInline') {
		const { automationGraph, ...settings } = binding;
		return settings;
	}
	if (binding.inputSource === 'keyframesTimelineInline') {
		const { keyframesTimeline, ...settings } = binding;
		return [settings, keyframesTimeline?.isNormalized, keyframesTimeline?.keyframes.map((point: { id: string; x: number }) => [point.id, point.x])];
	}
	return binding;
}
