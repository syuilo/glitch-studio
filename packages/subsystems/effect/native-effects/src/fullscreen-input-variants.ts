import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey, type FixedShaderInput, type ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { EffectInitContext, EffectRenderOperation } from '@gs/subsystems_effect_renderer/effect-instance.ts';

type FullscreenInputs<Key extends string> = Readonly<Record<Key, FixedShaderInput>>;

/** 描画対象の入力がフレームごとに変わる全画面パス。入力種別ごとのpipelineを初期化時に生成する。 */
export async function createFullscreenEffectWithInputVariants<Key extends string>(context: EffectInitContext<unknown>, options: {
	code: string;
	schema: Readonly<Record<Key, ShaderInputType>>;
	inputVariants: Iterable<FullscreenInputs<NoInfer<Key>>>;
	selectInputs: () => FullscreenInputs<NoInfer<Key>>;
}): Promise<EffectRenderOperation> {
	const { device, resolution, defaultVertexShaderModule, outputTextures, signal } = context;
	const { code, schema, inputVariants, selectInputs } = options;
	const output = outputTextures.get('output')!;
	const passDescriptor: GPURenderPassDescriptor = {
		colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }],
	};
	const pipelines = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();

	function dispose() {
		for (const { bindings } of pipelines.values()) bindings.dispose();
	}

	try {
		for (const inputs of inputVariants) {
			const key = shaderInputVariantKey(schema, inputs);
			if (pipelines.has(key)) continue;
			signal?.throwIfAborted();
			const generated = generateShaderInputs(schema, inputs, 0, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const pipeline = await device.createRenderPipelineAsync({
					layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: {
						module: device.createShaderModule({ code: generated.code + '\n' + code }),
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

	const inputKeys = Object.keys(schema) as Key[];
	let active: { inputs: FullscreenInputs<Key>; pipeline: GPURenderPipeline; getBindGroup: () => GPUBindGroup } | null = null;
	return {
		cacheKey: 0,
		render({ commandEncoder }) {
			const inputs = selectInputs();
			const previous = active;
			if (previous == null || inputKeys.some(key => previous.inputs[key] !== inputs[key])) {
				const { pipeline, bindings } = pipelines.get(shaderInputVariantKey(schema, inputs))!;
				// 入力が変わるときだけFit・Wrap・Filterを設定し直す。同種別では同じuniform bufferを使うため、現在の組だけを保持する。
				const getBindGroup = bindings.bindFixedInputs(inputs, resolution);
				active = { inputs, pipeline, getBindGroup };
			}
			const { pipeline, getBindGroup } = active!;
			const bindGroup = getBindGroup();
			const pass = commandEncoder.beginRenderPass(passDescriptor);
			try {
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
			} finally { pass.end(); }
		},
		dispose,
	};
}
