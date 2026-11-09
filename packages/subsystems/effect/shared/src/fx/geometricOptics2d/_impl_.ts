import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { bounded, createOpticalSceneData, OPTICAL_RECORD_BYTES } from './scene-data.ts';
import commonCode from './common.wgsl?raw';
import traceCode from './trace.wgsl?raw';
import drawCode from './draw.wgsl?raw';
import compositeCode from './composite.wgsl?raw';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule }, resolution }) => {
		const uniforms = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.settings);
		const uniformBuffer = device.createBuffer({ size: uniforms.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const uniformLayout = (visibility: GPUShaderStageFlags): GPUBindGroupLayoutEntry => ({ binding: 0, visibility, buffer: { type: 'uniform' } });
		const traceLayout = device.createBindGroupLayout({ entries: [
			uniformLayout(GPUShaderStage.COMPUTE),
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const drawLayout = device.createBindGroupLayout({ entries: [
			uniformLayout(GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT),
			{ binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const compositeLayout = device.createBindGroupLayout({ entries: [uniformLayout(GPUShaderStage.FRAGMENT), { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }] });
		// 描画インスタンスの順序を固定した浮動小数点の加算合成。atomic加算の実行順には依存しない。
		const accumulated = device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
		const accumulatedView = accumulated.createView();
		const drawModule = device.createShaderModule({ code: commonCode + '\n' + drawCode });
		const drawPipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
			vertex: { module: drawModule, entryPoint: 'segmentVertex' },
			fragment: { module: drawModule, entryPoint: 'segmentFragment', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT, blend: {
				color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
			} }] },
			primitive: { topology: 'triangle-list' },
		});
		const compositePipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + compositeCode }), entryPoint: 'composite', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		const compositeGroup = device.createBindGroup({ layout: compositeLayout, entries: [uniformEntry, { binding: 1, resource: accumulatedView }] });
		const schema = { sdfs: { array: 'scalar' } } as const;

		function createTraceVariant(sdfs: readonly ShaderInput[]) {
			const generated = generateShaderInputs(schema, { sdfs }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const pipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [traceLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + traceCode }), entryPoint: 'traceOptics' },
				});
				return { key: generated.variantKey, pipeline, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		function createBuffers(objectBytes: number, rootBytes: number, segmentBytes: number) {
			const create = (size: number) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			const objects = create(objectBytes);
			const roots = create(rootBytes);
			const segments = create(segmentBytes);
			return {
				objectBytes, rootBytes, segmentBytes, objects, roots, segments,
				traceGroup: device.createBindGroup({ layout: traceLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: objects } }, { binding: 2, resource: { buffer: roots } }, { binding: 3, resource: { buffer: segments } }] }),
				drawGroup: device.createBindGroup({ layout: drawLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: segments } }] }),
				dispose: () => { objects.destroy(); roots.destroy(); segments.destroy(); },
			};
		}

		let buffers: ReturnType<typeof createBuffers> | null = null;
		let variant: ReturnType<typeof createTraceVariant> | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const scene = createOpticalSceneData(params, resolution, device.limits);
				const lineWidth = bounded(params.lineWidth, 0, 1, 0.003);
				if (scene.rootCount === 0 || lineWidth === 0) {
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				const key = shaderInputVariantKey(schema, { sdfs: scene.sdfs });
				if (variant == null || variant.key !== key) {
					const replacement = createTraceVariant(scene.sdfs);
					variant?.bindings.dispose();
					variant = replacement;
				}
				const segmentBytes = scene.pathBudget * OPTICAL_RECORD_BYTES;
				if (buffers == null || buffers.objectBytes < scene.objects.byteLength || buffers.rootBytes < scene.roots.byteLength || buffers.segmentBytes < segmentBytes) {
					const replacement = createBuffers(scene.objects.byteLength, scene.roots.byteLength, segmentBytes);
					buffers?.dispose();
					buffers = replacement;
				}
				const pixelSize = 1 / Math.max(resolution.width, resolution.height);
				const maxInteractions = Math.round(bounded(params.maxInteractions, 0, 32, 12));
				// 各深さの反射+透過パワーは初期値を超えない。全光線の絶対応答を使った
				// 保守的な上限で、加算途中の16bit overflowや+Infと-Infの相殺を防ぐ。
				// 描画後に倍率を戻すので、露出や光量を勝手に下げるものではない。
				const accumulationScale = Math.min(1, 16000 * Math.max(lineWidth, pixelSize) / Math.max(1e-20, scene.maximumAbsoluteResponse * (maxInteractions + 1)));
				uniforms.set({
					// 境界からの再出発で光路を大きくずらさないよう、交差許容誤差は画素より十分小さくする。
					halfExtent: getSpatialHalfExtent(resolution), pixelSize, boundaryEpsilon: pixelSize / 64,
					maximumStep: bounded(params.maximumStep, 0.000001, 1, 0.005), maximumSteps: Math.round(bounded(params.maximumSteps, 1, 8192, 2048)),
					rootCount: scene.rootCount, pathBudget: scene.pathBudget,
					maxInteractions, minimumRelativePower: bounded(params.minimumRelativePower, 0, 1, 0.001), accumulationScale,
					exteriorIor: bounded(params.exteriorIor, 1, 10, 1), lineWidth, exposure: 2 ** bounded(params.exposure, -20, 20, -2),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);
				device.queue.writeBuffer(buffers.objects, 0, scene.objects);
				device.queue.writeBuffer(buffers.roots, 0, scene.roots);
				// 予算の未使用領域も毎回消し、物体・光源の削除や打ち切り後に古い光路を残さない。
				ctx.commandEncoder.clearBuffer(buffers.segments);
				const inputGroup = variant.bindings.update({ sdfs: scene.sdfs }, resolution);
				const tracePass = ctx.createComputePassEncoder(ctx.commandEncoder);
				tracePass.setPipeline(variant.pipeline);
				tracePass.setBindGroup(0, buffers.traceGroup);
				tracePass.setBindGroup(1, inputGroup);
				tracePass.dispatchWorkgroups(Math.ceil(scene.rootCount / 64));
				tracePass.end();
				const drawPass = ctx.createPassEncoderFor(ctx.commandEncoder, accumulatedView);
				drawPass.setPipeline(drawPipeline);
				drawPass.setBindGroup(0, buffers.drawGroup);
				drawPass.draw(6, scene.pathBudget);
				drawPass.end();
				const compositePass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				compositePass.setPipeline(compositePipeline);
				compositePass.setBindGroup(0, compositeGroup);
				compositePass.draw(3);
				compositePass.end();
			},
			dispose: () => { variant?.bindings.dispose(); buffers?.dispose(); accumulated.destroy(); uniformBuffer.destroy(); },
		};
	},
});
