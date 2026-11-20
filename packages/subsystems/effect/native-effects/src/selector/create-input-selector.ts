import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { EffectInitContext } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffectWithInputVariants } from '../fullscreen-input-variants.ts';
import shader from './selector.wgsl?raw';

type SelectorInputs = {
	inputs: { readonly kind: 'array'; readonly elements: readonly ShaderInput[] };
	index: { readonly value: number };
};

export function createInputSelector(context: EffectInitContext<SelectorInputs>, type: 'color' | 'scalar' | 'vector') {
	const zeroInput = { kind: 'uniform', value: [0, 0, 0, 0] } as const;
	const { inputs, index } = context.inputs;
	// 描画ごとに選択中の入力だけを束縛する。候補数をGPUのテクスチャ数上限から切り離し、
	// 各接続のFit・Wrap Mode・Filterをそのまま使う。
	const candidates = inputs.elements.map(input => ({ source: input }));
	const empty = { source: zeroInput };
	const lastIndex = Math.max(0, candidates.length - 1);
	const resultType = { color: 'vec4f', scalar: 'f32', vector: 'vec2f' }[type];

	return createFullscreenEffectWithInputVariants(context, {
		code: 'alias SelectedValue = ' + resultType + ';\n' + shader,
		schema: { source: type },
		inputVariants: candidates.length > 0 ? candidates : [empty],
		selectInputs() {
			const value = index.value;
			// UI以外から式やキーフレームで小数も渡る。Indexを最も近い整数に丸め、その候補だけを描画に渡す。
			const selectedIndex = Number.isNaN(value) ? 0 : Math.round(Math.min(lastIndex, Math.max(0, value)));
			return candidates[selectedIndex] ?? empty;
		},
	});
}
