import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectNode, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { EffectFrame, EffectInputLayout } from '../effect-instance.ts';

export type EvaluateCustomNodeGraphEffectBinding = (binding: ValueParameterBinding, definition: ParameterDefinition, context: {
	customNodeGraphEffect: CustomNodeGraphEffect;
	node: CustomNodeGraphEffectNode;
	resolution: Readonly<Resolution>;
	// 評価するBindingが属するグラフのフレーム。式から参照できる公開引数はCPU値だけで、
	// 空間入力の追加読取・上流の再評価は行わない。キーや式に与える時計もこのフレームのものを使う。
	frame: EffectFrame;
}) => unknown;

export type ParameterReader = {
	layout: EffectInputLayout;
	// 配列・構造体も、内部に含まれるテクスチャの最大画素数を自動解像度の候補にする。
	textureResolution: Readonly<Resolution> | null;
	read: (frame: EffectFrame) => unknown;
};

export type ParameterReaderContext = {
	resolveConnection: (connection: CustomNodeGraphEffectConnection) => ParameterReader | null;
	evaluate: (binding: ValueParameterBinding, definition: ParameterDefinition, frame: EffectFrame) => unknown;
};

export function largestResolution(resolutions: Iterable<Readonly<Resolution> | null>): Readonly<Resolution> | null {
	let largest: Readonly<Resolution> | null = null;
	for (const resolution of resolutions) {
		if (resolution != null && (largest == null || resolution.width * resolution.height > largest.width * largest.height)) largest = resolution;
	}
	return largest;
}

export type PlannedParameter = (context: ParameterReaderContext) => ParameterReader;

// 配線をたどるのは計画時だけ。初期化時に各入力の表現・解像度を確定し、フレームごとには値だけを読む。
export function planParameter(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding,
	requireConnection: (connection: CustomNodeGraphEffectConnection) => void, requireExpressionScope: () => void): PlannedParameter {
	const canNode = definition.canNode === true;
	const literalValue = (value: unknown) => canNode ? constantShaderInput(definition.dataType.kind, value) : value;
	const valueLayout: EffectInputLayout = { kind: canNode ? 'uniform' : 'value' };
	if (binding.inputSource === 'node' || binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
		requireConnection(binding);
		const sampling = { fitMode: binding.fitMode ?? 'cover', wrapMode: binding.wrapMode ?? 'repeatMirrored', filterMode: binding.filterMode ?? 'linear' } as const;
		return context => {
			const source = context.resolveConnection(binding);
			if (source == null) {
				// 未接続の公開出力を参照した入力は自身の既定値を使い、Shader入力の種別もここで固定する。
				const fallback = literalValue(definition.defaultValue.value);
				return { layout: valueLayout, textureResolution: null, read: () => fallback };
			}
			if (!canNode) return source;
			if (source.layout.kind === 'value') {
				return { layout: { kind: 'uniform' }, textureResolution: null, read: frame => literalValue(source.read(frame)) };
			}
			// 公開入力を経由しても受け取り側の接続でサンプリングする。定数の色は既に乗算済み。
			return { ...source, read: frame => toShaderInput(source.read(frame) as UniformOrTexture, sampling) };
		};
	}
	if (binding.inputSource === 'literal' && isParameterType(definition, 'array')) {
		const elementDefinition = getArrayElementDefinition(definition);
		const elements = (binding.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[])
			.map(element => planParameter(elementDefinition, element.binding, requireConnection, requireExpressionScope));
		return context => {
			const readers = elements.map(element => element(context));
			return { layout: { kind: 'value' }, textureResolution: largestResolution(readers.map(reader => reader.textureResolution)),
				read: frame => readers.map(reader => reader.read(frame)) };
		};
	}
	if (binding.inputSource === 'literal' && isParameterType(definition, 'struct')) {
		const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, field]) =>
			[key, planParameter(field, binding.value[key] ?? field.defaultValue, requireConnection, requireExpressionScope)] as const);
		return context => {
			const readers = fields.map(([key, field]) => [key, field(context)] as const);
			return { layout: { kind: 'value' }, textureResolution: largestResolution(readers.map(([, reader]) => reader.textureResolution)),
				read: frame => Object.fromEntries(readers.map(([key, reader]) => [key, reader.read(frame)])) };
		};
	}
	if (binding.inputSource === 'literal' && binding.expressionModifier?.enabled !== true) {
		const value = literalValue(binding.value);
		return () => ({ layout: valueLayout, textureResolution: null, read: () => value });
	}
	// 式が公開パラメータを実行時の名前で読む場合にも、子の必要入力を取りこぼさない。
	requireExpressionScope();
	return context => ({ layout: valueLayout, textureResolution: null, read: frame => literalValue(context.evaluate(binding, definition, frame)) });
}
