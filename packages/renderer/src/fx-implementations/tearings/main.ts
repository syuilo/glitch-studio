import seedrandom from 'seedrandom';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/fx-definitions/tearings.ts';

const maxTearings = 128;

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, params, fallbackTexture }) => {
		const shaderModule = wgpu.device.createShaderModule({ code });
		const shaderDataDefinitions = makeShaderDataDefinitions(code);
		const pipeline = wgpu.device.createRenderPipeline({
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: {
				module: shaderModule,
				targets: [{ format: wgpu.intermediateTextureFormat }],
			},
			primitive: { topology: 'triangle-list' },
			layout: 'auto',
		});

		const uniformValues = makeStructuredView(shaderDataDefinitions.uniforms.uniforms);
		const uniformBuffer = wgpu.device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const samplers = {
			clampToEdge: wgpu.device.createSampler({
				magFilter: 'nearest',
				minFilter: 'nearest',
				addressModeU: 'clamp-to-edge',
				addressModeV: 'clamp-to-edge',
			}),
			repeat: wgpu.device.createSampler({
				magFilter: 'nearest',
				minFilter: 'nearest',
				addressModeU: 'repeat',
				addressModeV: 'repeat',
			}),
			repeatMirrored: wgpu.device.createSampler({
				magFilter: 'nearest',
				minFilter: 'nearest',
				addressModeU: 'mirror-repeat',
				addressModeV: 'mirror-repeat',
			}),
		};

		let inputTexture = params.input;
		let wrap = params.wrap;
		let bindGroup: GPUBindGroup;
		const updateBindGroup = () => {
			bindGroup = wgpu.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: uniformBuffer } },
					{ binding: 2, resource: samplers[wrap] },
					{ binding: 3, resource: (inputTexture ?? fallbackTexture).createView() },
				],
			});
		};
		updateBindGroup();

		const shifts = new Float32Array(maxTearings * 4);

		return {
			render: (ctx) => {
				if (ctx.params.input !== inputTexture || ctx.params.wrap !== wrap) {
					inputTexture = ctx.params.input;
					wrap = ctx.params.wrap;
					updateBindGroup();
				}

				const amount = Math.min(maxTearings, Math.max(0, Math.trunc(ctx.params.amount)));
				const rnd = seedrandom(ctx.params.seed.toString());
				for (let i = 0; i < amount; i++) {
					const offset = i * 4;
					shifts[offset] = rnd();
					shifts[offset + 1] = (1 - rnd() * 2) * ctx.params.strength;
					shifts[offset + 2] = rnd() * (ctx.params.size / 100);
				}

				uniformValues.set({
					amount,
					angle: ctx.params.angle * Math.PI,
					channelShift: ctx.params.channelShift,
					shifts,
				});
				wgpu.device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				const passEncoder = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, bindGroup);
				passEncoder.draw(6);
				passEncoder.end();
			},
			dispose: () => {
				uniformBuffer.destroy();
			},
		};
	},
});
