import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import precisionCode from './extended-precision.wgsl?raw';
import { getMandelbrotIterationCount, getMandelbrotSettings } from './mandelbrot-settings.ts';
import { createMandelbrotReferenceLoader } from './reference-orbit-loader.ts';
import { packMandelbrotNumber } from './extended-precision.ts';
import type { EffectOutputData, RuntimeEffectParameters } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	getRenderWorkloadHint: ({ params, usedOutputPorts }) => {
		// 入力テクスチャの内容更新をこの層では識別できない。座標を入力から読む場合は、
		// 前回の軽い領域の計測を流用せず、各描画で小さなタイルから確認する。
		if (params.coordinateOffset.kind !== 'uniform') return null;
		const rendersColor = usedOutputPorts == null || usedOutputPorts.has('output');
		return {
			workPerPixel: getMandelbrotIterationCount(params.maximumIterations) * (params.antialiasing ? 4 : 1),
			// 基準中心はnumberへ丸めず十進文字列のまま比較する。深ズームでは、numberで
			// 同じになる中心でも発散までの反復数が変わり得る。通常／摂動の演算方式も
			// ViewのZoomで区別し、1反復の費用が異なる方式間では計測を流用しない。
			// CPUの基準軌道に使うprecisionBitsはGPUの固定48bit演算の仕事量には加えない。
			key: JSON.stringify([params.referenceCenter, params.view, params.coordinateOffset.value, params.bailoutRadius,
				rendersColor ? params.coloringMethod : null, params.unescapedColor.kind,
				params.ramp.stops.length, params.ramp.interpolation, params.ramp.colorSpace,
				usedOutputPorts == null ? null : [...usedOutputPorts].sort()]),
		};
	},
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		escapeIterations: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			// 深ズームでは2048を超える整数も隣接値として保持する必要がある。
			format: 'r32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		smoothIterations: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: 'r32float',
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
	init: ({ wgpu, resolution, reportStatus }) => {
		const device = wgpu.device;
		const shaderCode = precisionCode + '\n' + code;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(shaderCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		let referenceBuffer: GPUBuffer | null = null;
		let bindGroup: GPUBindGroup | null = null;
		let complexCenter: readonly [number, number] = [0, 0];
		const referenceLoader = createMandelbrotReferenceLoader({
			reportStatus,
			publish(orbit) {
				const buffer = device.createBuffer({ size: orbit.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				device.queue.writeBuffer(buffer, 0, orbit.data);
				referenceBuffer?.destroy();
				referenceBuffer = buffer;
				complexCenter = orbit.center;
				bindGroup = device.createBindGroup({ layout, entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer } },
				] });
			},
		});
		const colorRamp = createColorRampBindings(device, 1);
		const spatialHalfExtent = getSpatialHalfExtent(resolution);

		function createPipelines(outputs: (EffectOutputData | null)[], coloringMethod: number, usePerturbation: boolean) {
			return createShaderInputPipeline({
				device,
				vertex: wgpu.defaultVertexShaderModule,
				code: colorRamp.shaderCode + '\n' + shaderCode,
				schema: { coordinateOffset: 'vector', unescapedColor: 'color' },
				targets: outputs.map(output => output == null ? null : { format: output.texture.format }),
				constants: {
					// 通常描画では整数多倍長演算をコンパイル時に除き、初期表示の負荷を増やさない。
					USE_PERTURBATION: usePerturbation ? 1 : 0,
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

		const pipelinesByOutputsColoringAndPrecision = new Map<number, ReturnType<typeof createPipelines>>();
		const longSide = Math.max(resolution.width, resolution.height);

		function prepare(params: RuntimeEffectParameters<typeof definition.paramDefs>, signal?: AbortSignal) {
			const settings = getMandelbrotSettings(params.view, params.maximumIterations, params.bailoutRadius, longSide);
			referenceLoader.prepare({
				center: [params.referenceCenter.real, params.referenceCenter.imaginary],
				centerOffset: params.view.center,
				precisionBits: settings.precisionBits,
				maximumIterations: settings.maximumIterations,
				bailoutRadius: settings.bailoutRadius,
				usePerturbation: settings.usePerturbation,
			}, signal);
		}

		return {
			prepare,
			get cacheVersion() { return referenceLoader.cacheVersion; },
			render: ctx => {
				prepare(ctx.params);
				if (!referenceLoader.ready || bindGroup == null) return;
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
				const settings = getMandelbrotSettings(ctx.params.view, ctx.params.maximumIterations, ctx.params.bailoutRadius, longSide);
				const bailoutRadius = settings.bailoutRadius;
				const rotation = ctx.params.view.rotation * Math.PI * 2;
				uniformValues.set({
					spatialHalfExtent,
					resolution: [resolution.width, resolution.height],
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					complexCenter,
					rotation: { real: packMandelbrotNumber(Math.cos(rotation)), imaginary: packMandelbrotNumber(Math.sin(rotation)) },
					rotationFloat: [Math.cos(rotation), Math.sin(rotation)],
					// 長辺全体=1の画面座標を、Zoom=1で複素平面の長さ4へ対応させる。
					complexScale: packMandelbrotNumber(settings.complexScale),
					pixelScale: packMandelbrotNumber(settings.complexScale / longSide),
					complexScaleFloat: settings.usePerturbation ? 0 : settings.complexScale,
					maximumIterations: settings.maximumIterations,
					bailoutRadius,
					log2LogBailoutRadius: Math.log2(Math.log(bailoutRadius)),
					iterationColorPeriod: Math.max(0.001, ctx.params.iterationColorPeriod),
					triangleColorDensity: Math.max(0, ctx.params.triangleColorDensity),
					colorPhase: ctx.params.colorPhase - Math.floor(ctx.params.colorPhase),
					antialiasing: ctx.params.antialiasing ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(ctx.params.ramp);
				const pipelineKey = outputMask | (coloringMethod << 5) | (settings.usePerturbation ? 1 << 7 : 0);
				let pipelines = pipelinesByOutputsColoringAndPrecision.get(pipelineKey);
				if (pipelines == null) {
					pipelines = createPipelines(outputs, coloringMethod, settings.usePerturbation);
					pipelinesByOutputsColoringAndPrecision.set(pipelineKey, pipelines);
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
				referenceLoader.dispose();
				referenceBuffer?.destroy();
				for (const pipelines of pipelinesByOutputsColoringAndPrecision.values()) pipelines.dispose();
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
