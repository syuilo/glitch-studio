import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from './parameter-definition.ts';
import { validateParameterExpressionModifier } from './parameter-expression-modifier.ts';
import { validateParameterValue } from './validate-parameter-value.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ParameterBindingBase, ParameterArrayElement } from './parameter-binding.ts';

/** 共通の入力方式のうち、対応表への変換を定義していない方式を入口で拒否する。 */
export function validateColorRampParameterInputSource(definition: Pick<ParameterDefinition, 'dataType'>, binding: ParameterBindingBase): void {
	if (definition.dataType.kind === 'colorRamp' && ['keyframesTimelineInline', 'curveAnimationReference', 'curveAnimationInline'].includes(binding.inputSource)) throw new Error('Color Ramp does not support keyframes or Curve Animation input');
}

/** コンテナの値と子設定の既定値をそれぞれ検査する。 */
export function validateParameterDefaultValues(definition: ParameterDefinition): void {
	validateDefaultValue(definition, definition.defaultValue);
	// 配列全体が空でも、新しい要素・フィールドの初期値には独立した既定値がある。
	if (isParameterType(definition, 'array')) {
		validateParameterDefaultValues(getArrayElementDefinition(definition));
	} else if (isParameterType(definition, 'struct')) {
		for (const field of Object.values(getStructFieldDefinitions(definition))) validateParameterDefaultValues(field);
	}
}

function validateDefaultValue(definition: ParameterDefinition, value: unknown): void {
	const kind = definition.dataType.kind;
	const invalidDefault = () => new Error(`Invalid ${kind} default value for parameter ${JSON.stringify(definition.ui?.label)}`);
	if (isParameterType(definition, 'array')) {
		if (!Array.isArray(value)) throw invalidDefault();
		if (definition.maxElements != null && value.length > definition.maxElements) {
			throw new Error(`Array default for parameter ${JSON.stringify(definition.ui?.label)} exceeds maxElements (${definition.maxElements})`);
		}
		const element = getArrayElementDefinition(definition);
		for (const elementValue of value) validateDefaultValue(element, elementValue);
		return;
	}
	if (isParameterType(definition, 'struct')) {
		if (value == null || typeof value !== 'object' || Array.isArray(value)) throw invalidDefault();
		const values = value as Record<string, unknown>;
		const fields = getStructFieldDefinitions(definition);
		if (Object.keys(values).length !== Object.keys(fields).length) throw invalidDefault();
		for (const [key, field] of Object.entries(fields)) {
			if (!Object.hasOwn(values, key)) throw invalidDefault();
			validateDefaultValue(field, values[key]);
		}
		return;
	}
	if (kind === 'audioSource') {
		// nullは未選択を表す保存値。undefinedは既定値の欠落として扱う。
		if (value !== null) throw invalidDefault();
		return;
	}
	if (kind === 'any') {
		if (value !== null && (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite))) throw invalidDefault();
		return;
	}
	if (!['scalar', 'bool', 'string', 'color', 'colorRamp', 'vector', 'blendMode', 'fitMode', 'sizeReference', 'wrapMode', 'enum'].includes(kind)) throw new Error('Unsupported parameter data type');
	// 式が受け取る文字列の数値変換は、型に対応する値を直接保存する定義には適用しない。
	if (kind === 'scalar' && typeof value !== 'number') throw invalidDefault();
	validateParameterValue(definition, value);
}

/** 値の妥当性は評価後に検査する。ここではBindingの構造と静的な参照だけを扱う。 */
export function inspectStaticParameter<Binding extends ParameterBindingBase>(definition: ParameterDefinition, binding: Binding,
	inspectLeaf: (definition: ParameterDefinition, binding: Binding) => void): void {
	if (!binding) throw new Error('Missing parameter binding');
	validateParameterExpressionModifier(definition, binding);
	if (!isParameterType(definition, 'array') && !isParameterType(definition, 'struct')) {
		validateColorRampParameterInputSource(definition, binding);
		inspectLeaf(definition, binding);
		return;
	}
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Container parameter must be literal');
	if (isParameterType(definition, 'array')) {
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
	const modifier = binding?.expressionModifier;
	const source = binding == null ? binding : { ...binding };
	if (source != null) delete source.expressionModifier;
	// 本文と有効状態は参照構造を変えない。保存形式が壊れた場合だけ静的検証をやり直す。
	const shape = staticParameterSourceShape(definition, source);
	return modifier == null ? shape : ['expressionModifier', [typeof modifier, typeof modifier.enabled, typeof modifier.code], shape];
}

function staticParameterSourceShape(definition: ParameterDefinition | null | undefined, binding: any): unknown {
	if (!binding) return null;
	if (binding.inputSource === 'literal') {
		if (definition != null && isParameterType(definition, 'array') && Array.isArray(binding.value)) {
			return ['array', binding.value.map((element: ParameterArrayElement) => [element.id, staticParameterShape(getArrayElementDefinition(definition), element.binding)])];
		}
		if (definition != null && isParameterType(definition, 'struct') && binding.value && typeof binding.value === 'object') {
			const fields = getStructFieldDefinitions(definition);
			return ['struct', Object.entries(binding.value).map(([key, value]) => [key, staticParameterShape(fields[key], value)])];
		}
		const kind = definition?.dataType.kind;
		return ['literal', kind != null && ['audioSource', 'array', 'struct'].includes(kind) ? binding.value : null];
	}
	if (binding.inputSource === 'expression') return ['expression'];
	if (binding.inputSource === 'curveAnimationInline') {
		const { curveAnimation, ...settings } = binding;
		return settings;
	}
	if (binding.inputSource === 'keyframesTimelineInline') {
		const { keyframesTimeline, ...settings } = binding;
		return [settings, keyframesTimeline?.isNormalized, keyframesTimeline?.keyframes.map((point: { id: string; x: number }) => [point.id, point.x])];
	}
	return binding;
}
