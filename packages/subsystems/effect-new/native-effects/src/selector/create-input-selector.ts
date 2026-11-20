import type { EffectImageInput, EffectInitContext } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../fullscreen-effect.ts';
import shader from './selector.wgsl?raw';

type SelectorInputs = {
	inputs: { readonly kind: 'array'; readonly elements: readonly EffectImageInput[] };
	index: { readonly value: number };
};

export function createInputSelector(context: EffectInitContext<SelectorInputs>, type: 'color' | 'scalar' | 'vector') {
	const { inputs, index } = context.inputs;
	const last = Math.max(0, inputs.elements.length - 1);
	const selection = [0, 0];
	const resultType = { color: 'vec4f', scalar: 'f32', vector: 'vec2f' }[type];
	return createFullscreenEffect(context, {
		code: 'alias SelectedValue = ' + resultType + ';\n' + shader,
		schema: { inputs: { array: type }, selection: 'vector' },
		inputs: {
			inputs,
			selection: {
				kind: 'uniform',
				get value() {
					// 整数部と補間率を分けてからf32へ渡す。空配列はread_inputsの範囲外値（ゼロ）で描く。
					const value = index.value;
					const bounded = Number.isNaN(value) ? 0 : Math.min(last, Math.max(0, value));
					selection[0] = Math.floor(bounded);
					selection[1] = bounded - selection[0];
					return selection;
				},
			},
		},
		sampling: 'level0',
	});
}
