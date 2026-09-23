import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputBindings, generateShaderInputs } from '../../shader-input.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const schema = { inputA: 'color', inputB: 'color', amount: 'scalar' } as const;
		// 値やfit/wrapではコンパイルし直さず、実際に使用した入力種別の組合せだけ保持する。
		// このエフェクトでは最大8種類。ノードごとのbufferはdisposeで全て破棄する。
		const variants = new Map<string, { pipeline: GPURenderPipeline; bindings: ReturnType<typeof createShaderInputBindings> }>();
		return {
			render: ctx => {
				const key = [ctx.params.inputA.kind, ctx.params.inputB.kind, ctx.params.amount.kind].join(',');
				let variant = variants.get(key);
				if (variant == null) {
					const generated = generateShaderInputs(schema, ctx.params);
					const bindings = createShaderInputBindings(device, generated);
					const pipeline = device.createRenderPipeline({
						layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
						vertex: { module: wgpu.defaultVertexShaderModule },
						fragment: { module: device.createShaderModule({ code: generated.code + '\n' + code }), targets: [{ format: wgpu.intermediateTextureFormat }] },
						primitive: { topology: 'triangle-list' },
					});
					variant = { pipeline, bindings };
					variants.set(key, variant);
				}
				const group = variant.bindings.update(ctx.params, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				for (const variant of variants.values()) variant.bindings.dispose();
				variants.clear();
			},
		};
	},
});
