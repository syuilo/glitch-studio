import { toFixedShaderInput, type EffectImageInput, type EffectInitContext } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffectWithInputVariants } from '../fullscreen-input-variants.ts';
import shader from './interpolator.wgsl?raw';

type InterpolatorInputs = {
	inputs: { readonly kind: 'array'; readonly elements: readonly EffectImageInput[] };
	index: { readonly value: number };
};

export function createInputInterpolator(context: EffectInitContext<InterpolatorInputs>, type: 'color' | 'scalar' | 'vector') {
	const zeroInput = { kind: 'uniform', value: [0, 0, 0, 0] } as const;
	const { inputs, index } = context.inputs;
	// 描画ごとに隣接する最大2入力を束縛するため、候補数はGPUのテクスチャ数上限に依存せず、
	// 各接続のFit・Wrap Mode・Filterも維持できる。
	const candidates = inputs.elements.map(toFixedShaderInput);
	const lastIndex = Math.max(0, candidates.length - 1);
	const blendWeight = { kind: 'uniform' as const, value: [0] };
	const resultType = { color: 'vec4f', scalar: 'f32', vector: 'vec2f' }[type];

	// 候補の種別は配置中に変わらないため、整数端点と隣接する候補の組から必要なpipelineを初期化時に決められる。
	function* inputVariants() {
		if (candidates.length === 0) yield { first: zeroInput, second: zeroInput, blendWeight };
		for (const [candidateIndex, first] of candidates.entries()) {
			yield { first, second: zeroInput, blendWeight };
			const second = candidates[candidateIndex + 1];
			if (second != null) yield { first, second, blendWeight };
		}
	}

	return createFullscreenEffectWithInputVariants(context, {
		code: 'alias InterpolatedValue = ' + resultType + ';\n' + shader,
		schema: { first: type, second: type, blendWeight: 'scalar' },
		inputVariants: inputVariants(),
		selectInputs() {
			const value = index.value;
			const boundedIndex = Number.isNaN(value) ? 0 : Math.min(lastIndex, Math.max(0, value));
			const lowerIndex = Math.floor(boundedIndex);
			// GPUへ渡すf32の補間率で端点を判定し、寄与する候補が片方だけならその候補だけをbindする。
			const fraction = Math.fround(boundedIndex - lowerIndex);
			const interpolate = fraction > 0 && fraction < 1;
			const first = candidates[fraction === 1 ? lowerIndex + 1 : lowerIndex] ?? zeroInput;
			const second = interpolate ? candidates[lowerIndex + 1] : zeroInput;
			blendWeight.value[0] = interpolate ? fraction : 0;
			return { first, second, blendWeight };
		},
	});
}
