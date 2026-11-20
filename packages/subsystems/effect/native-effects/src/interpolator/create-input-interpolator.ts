import { createShaderInputBindings, generateShaderInputs, type FixedShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { toFixedShaderInput, type EffectImageInput, type EffectInitContext, type EffectRenderOperation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import shader from './interpolator.wgsl?raw';

type InterpolatorInputs = {
	inputs: { readonly kind: 'array'; readonly elements: readonly EffectImageInput[] };
	index: { readonly value: number };
};

const zeroInput = { kind: 'uniform', value: [0, 0, 0, 0] } as const;

function selectionPipelineKey(first: FixedShaderInput, second: FixedShaderInput) {
	return `${first.kind}:${second.kind}`;
}

export async function createInputInterpolator(context: EffectInitContext<InterpolatorInputs>, type: 'color' | 'scalar' | 'vector'): Promise<EffectRenderOperation> {
	const { device, resolution, defaultVertexShaderModule, outputTextures, signal } = context;
	const { inputs, index } = context.inputs;
	const candidates = inputs.elements.map(toFixedShaderInput);
	const lastIndex = Math.max(0, candidates.length - 1);
	const blendWeight = { kind: 'uniform' as const, value: [0] };
	const schema = { first: type, second: type, blendWeight: 'scalar' } as const;
	const resultType = { color: 'vec4f', scalar: 'f32', vector: 'vec2f' }[type];
	const output = outputTextures.get('output')!;
	const passDescriptor: GPURenderPassDescriptor = {
		colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }],
	};
	const pipelineInputs = new Map<string, { first: FixedShaderInput; second: FixedShaderInput }>();
	const pipelines = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();

	function registerInputs(first: FixedShaderInput, second: FixedShaderInput) {
		const key = selectionPipelineKey(first, second);
		if (!pipelineInputs.has(key)) pipelineInputs.set(key, { first, second });
	}

	// 候補の種別は配置中に変わらない。単独選択と隣接する候補の補間に必要な種別の組だけを生成し、Index変更時のコンパイルを避ける。
	if (candidates.length === 0) registerInputs(zeroInput, zeroInput);
	for (const [candidateIndex, candidate] of candidates.entries()) {
		registerInputs(candidate, zeroInput);
		const nextCandidate = candidates[candidateIndex + 1];
		if (nextCandidate != null) registerInputs(candidate, nextCandidate);
	}

	function dispose() {
		for (const { bindings } of pipelines.values()) bindings.dispose();
	}

	try {
		for (const [key, pair] of pipelineInputs) {
			signal?.throwIfAborted();
			const generated = generateShaderInputs(schema, { ...pair, blendWeight }, 0, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const pipeline = await device.createRenderPipelineAsync({
					layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: {
					module: device.createShaderModule({ code: generated.code + '\nalias InterpolatedValue = ' + resultType + ';\n' + shader }),
						targets: [{ format: output.format }],
					},
				});
				pipelines.set(key, { pipeline, bindings });
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}
	} catch (error) {
		dispose();
		throw error;
	}

	let activeSelection: { first: FixedShaderInput; second: FixedShaderInput; pipeline: GPURenderPipeline; getBindGroup: () => GPUBindGroup } | null = null;
	return {
		cacheKey: 0,
		render({ commandEncoder }) {
			const value = index.value;
			const boundedIndex = Number.isNaN(value) ? 0 : Math.min(lastIndex, Math.max(0, value));
			const lowerIndex = Math.floor(boundedIndex);
			// GPUへ渡すf32の補間率で端点を判定し、寄与する候補が片方だけならその候補だけをbindする。
			const fraction = Math.fround(boundedIndex - lowerIndex);
			const interpolate = fraction > 0 && fraction < 1;
			const first = candidates[fraction === 1 ? lowerIndex + 1 : lowerIndex] ?? zeroInput;
			const second = interpolate ? candidates[lowerIndex + 1] : zeroInput;
			blendWeight.value[0] = interpolate ? fraction : 0;

			if (activeSelection == null || first !== activeSelection.first || second !== activeSelection.second) {
				const { pipeline, bindings } = pipelines.get(selectionPipelineKey(first, second))!;
				// 同種別の組はuniform bufferを再利用する。選択が変わったときにFit・Wrap・Filterを詰め直し、現在の組だけを保持する。
				const getBindGroup = bindings.bindFixedInputs({ first, second, blendWeight }, resolution);
				activeSelection = { first, second, pipeline, getBindGroup };
			}
			const bindGroup = activeSelection.getBindGroup();
			const pass = commandEncoder.beginRenderPass(passDescriptor);
			try {
				pass.setPipeline(activeSelection.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
			} finally { pass.end(); }
		},
		dispose,
	};
}
