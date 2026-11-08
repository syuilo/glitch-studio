import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type { EffectOutputData } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		escapeIterations: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		smoothIterations: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		escapedMask: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		triangleInequalityAverage: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		const spatialHalfExtent = getSpatialHalfExtent(resolution);

		function createPipelines(outputs: (EffectOutputData | null)[], coloringMethod: number) {
			return createShaderInputPipeline({
				device,
				vertex: wgpu.defaultVertexShaderModule,
				code: colorRamp.shaderCode + '\n' + code,
				schema: { coordinateOffset: 'vector', unescapedColor: 'color' },
				targets: outputs.map(output => output == null ? null : { format: output.texture.format }),
				constants: {
					RENDER_COLOR: outputs[0] != null ? 1 : 0,
					COLORING_METHOD: coloringMethod,
					CALCULATE_SMOOTH_ITERATIONS: outputs[2] != null || (outputs[0] != null && coloringMethod === 1) ? 1 : 0,
					// TIAは各反復に追加の演算が入るため、使用する彩色・出力だけで有効にする。
					CALCULATE_TRIANGLE_AVERAGE: outputs[4] != null || (outputs[0] != null && coloringMethod === 2) ? 1 : 0,
				},
				internalLayouts: [layout, colorRamp.layout],
				// 反復の終了・未発散領域の分岐は画素ごとに異なる。入力参照も微分に依存させない。
				sampling: 'level0',
			});
		}

		const pipelinesByOutputsAndColoring = new Map<number, ReturnType<typeof createPipelines>>();

		return {
			render: ctx => {
				const outputs = [
					ctx.usedOutputPorts == null || ctx.usedOutputPorts.has('output') ? ctx.outputDataMap.output : null,
					ctx.outputDataMap.escapeIterations ?? null,
					ctx.outputDataMap.smoothIterations ?? null,
					ctx.outputDataMap.escapedMask ?? null,
					ctx.outputDataMap.triangleInequalityAverage ?? null,
				];
				const outputMask = outputs.reduce((mask, output, index) => output == null ? mask : mask | (1 << index), 0);
				if (outputMask === 0) { return; }
				// 画像が不要なら、選択中の彩色方式による重複pipelineや不要なTIA演算を作らない。
				const coloringMethod = outputs[0] == null ? 0 : ['escapeIterations', 'smoothEscapeIterations', 'triangleInequalityAverage'].indexOf(ctx.params.coloringMethod);
				// 反復前の|z|をこの半径以下に抑える。二乗後の最大1e24もf32に収まり、
				// さらに二乗ノルムを求めないことで、発散判定自体のオーバーフローを避ける。
				const bailoutRadius = Math.min(1e12, Math.max(2, ctx.params.bailoutRadius));
				const rotation = ctx.params.rotation * Math.PI * 2;
				uniformValues.set({
					spatialHalfExtent,
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					complexCenter: ctx.params.complexCenter,
					rotation: [Math.cos(rotation), Math.sin(rotation)],
					// 長辺全体=1の画面座標を、Zoom=1で複素平面の長さ4へ対応させる。
					complexScale: 4 / Math.max(0.001, ctx.params.zoom),
					maximumIterations: Math.min(2048, Math.max(1, Math.floor(ctx.params.maximumIterations))),
					bailoutRadius,
					log2LogBailoutRadius: Math.log2(Math.log(bailoutRadius)),
					iterationColorPeriod: Math.max(0.001, ctx.params.iterationColorPeriod),
					triangleColorDensity: Math.max(0, ctx.params.triangleColorDensity),
					colorPhase: ctx.params.colorPhase - Math.floor(ctx.params.colorPhase),
					antialiasing: ctx.params.antialiasing ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(ctx.params.ramp);
				const pipelineKey = outputMask | (coloringMethod << 5);
				let pipelines = pipelinesByOutputsAndColoring.get(pipelineKey);
				if (pipelines == null) {
					pipelines = createPipelines(outputs, coloringMethod);
					pipelinesByOutputsAndColoring.set(pipelineKey, pipelines);
				}
				const variant = pipelines.update({
					coordinateOffset: ctx.params.coordinateOffset,
					unescapedColor: ctx.params.unescapedColor,
				}, resolution);
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => output == null ? null : {
						view: output.textureView,
						clearValue: [0, 0, 0, 0],
						loadOp: 'clear' as const,
						storeOp: 'store' as const,
					}),
				});
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(1, rampBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByOutputsAndColoring.values()) pipelines.dispose();
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
