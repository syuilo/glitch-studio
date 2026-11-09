import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { SPECTRAL_SAMPLE_COUNT } from '../../optics/spectral-samples.ts';
import { createColorFilterSamples, LIQUID_CRYSTAL_LAYER_COUNT, RESPONSE_SAMPLE_COUNT } from './optical-data.ts';
import opticalShaderCode from './optics.wgsl?raw';
import responseShaderCode from './response.wgsl?raw';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const constants = `const RESPONSE_SAMPLE_COUNT = ${RESPONSE_SAMPLE_COUNT}u;
const SPECTRAL_SAMPLE_COUNT = ${SPECTRAL_SAMPLE_COUNT}u;
const LIQUID_CRYSTAL_LAYER_COUNT = ${LIQUID_CRYSTAL_LAYER_COUNT}u;
`;

function viewingAngleRadians(turns: number): number {
	// 1周を同じ角度に戻してから前面の±85°へ制限する。背面からの光の伝搬は扱わない。
	const signedTurns = ((turns + 0.5) % 1 + 1) % 1 - 0.5;
	return Math.max(-85 / 360, Math.min(85 / 360, signedTurns)) * 2 * Math.PI;
}

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const opticalCode = constants + opticalShaderCode;
		const responseCode = constants + responseShaderCode;
		const frontUniformValues = makeStructuredView(makeShaderDataDefinitions(opticalCode).uniforms.uniforms);
		const viewUniformValues = makeStructuredView(makeShaderDataDefinitions(opticalCode).uniforms.uniforms);
		const responseUniformValues = makeStructuredView(makeShaderDataDefinitions(responseCode).uniforms.uniforms);
		const frontUniformBuffer = device.createBuffer({ size: frontUniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const viewUniformBuffer = device.createBuffer({ size: viewUniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const responseUniformBuffer = device.createBuffer({ size: responseUniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const spectralSamples = createColorFilterSamples();
		const spectralBuffer = device.createBuffer({ size: spectralSamples.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(spectralBuffer, 0, spectralSamples);
		// 光学応答は画像解像度と無関係な1次元表。float32で保持し、急な階調変化や
		// 逆変換でhalf精度の量子化を増幅しない。画像用の精度設定とは独立させる。
		const createResponseTexture = () => device.createTexture({
			size: [RESPONSE_SAMPLE_COUNT, 1],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const frontResponse = createResponseTexture();
		const viewResponse = createResponseTexture();
		const calibratedResponse = createResponseTexture();
		const frontResponseView = frontResponse.createView();
		const viewResponseView = viewResponse.createView();
		const calibratedResponseView = calibratedResponse.createView();
		const opticalLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const opticalModule = device.createShaderModule({ code: opticalCode });
		const opticalPipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [opticalLayout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: opticalModule, targets: [{ format: 'rgba32float' }] },
		});
		const createOpticalGroup = (buffer: GPUBuffer) => device.createBindGroup({ layout: opticalLayout, entries: [
			{ binding: 0, resource: { buffer } },
			{ binding: 1, resource: { buffer: spectralBuffer } },
		] });
		const frontOpticalGroup = createOpticalGroup(frontUniformBuffer);
		const viewOpticalGroup = createOpticalGroup(viewUniformBuffer);
		const responseLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const responsePipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [responseLayout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: responseCode }), targets: [{ format: 'rgba32float' }] },
		});
		const responseGroup = device.createBindGroup({ layout: responseLayout, entries: [
			{ binding: 0, resource: { buffer: responseUniformBuffer } },
			{ binding: 1, resource: frontResponseView },
			{ binding: 2, resource: viewResponseView },
		] });
		const imageLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
		const imageGroup = device.createBindGroup({ layout: imageLayout, entries: [{ binding: 0, resource: calibratedResponseView }] });
		const imagePipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: constants + shaderCode,
			schema: { input: 'color', amount: 'scalar' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [imageLayout],
			sampling: 'level0',
		});
		let previousOpticalValues: number[] | null = null;
		let previousViewValues: number[] | null = null;
		let previousResponseValues: number[] | null = null;
		const changed = (previous: number[] | null, current: number[]) => previous == null || current.some((value, index) => value !== previous[index]);
		return {
			render: ctx => {
				const params = ctx.params;
				const opticalUniforms = {
					thicknessNm: Math.max(0, params.cellThickness) * 1000,
					ordinaryIor: Math.max(1, params.ordinaryIor),
					extraordinaryIor: Math.max(1, params.extraordinaryIor),
					// 固定分割数で扱うため、セル全体のねじれは±1周までにする。
					twistAngle: Math.max(-1, Math.min(1, params.twistAngle)) * 2 * Math.PI,
					pretiltAngle: Math.max(-0.125, Math.min(0.125, params.pretiltAngle)) * 2 * Math.PI,
					panelRotation: (params.panelRotation % 1) * 2 * Math.PI,
					polarizerAngle: (params.polarizerAngle % 0.5) * 2 * Math.PI,
					analyzerAngle: (params.analyzerAngle % 0.5) * 2 * Math.PI,
				};
				const opticalValues = Object.values(opticalUniforms);
				const viewValues = [viewingAngleRadians(params.horizontalViewingAngle), viewingAngleRadians(params.verticalViewingAngle)];
				const responseValues = [params.calibrateFrontView ? 1 : 0, Math.max(0, params.brightness)];
				const opticalChanged = changed(previousOpticalValues, opticalValues);
				const viewChanged = opticalChanged || changed(previousViewValues, viewValues);
				// これは現在の材質・視線だけから再生成できるキャッシュであり、描画履歴ではない。
				// 入力画像・時刻・解像度だけが変わるフレームでは、画像適用の1パスだけを行う。
				if (opticalChanged) {
					frontUniformValues.set({ ...opticalUniforms, viewingAngles: [0, 0] });
					device.queue.writeBuffer(frontUniformBuffer, 0, frontUniformValues.arrayBuffer);
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, frontResponseView);
					pass.setPipeline(opticalPipeline);
					pass.setBindGroup(0, frontOpticalGroup);
					pass.draw(3);
					pass.end();
				}
				if (viewChanged) {
					viewUniformValues.set({ ...opticalUniforms, viewingAngles: viewValues });
					device.queue.writeBuffer(viewUniformBuffer, 0, viewUniformValues.arrayBuffer);
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, viewResponseView);
					pass.setPipeline(opticalPipeline);
					pass.setBindGroup(0, viewOpticalGroup);
					pass.draw(3);
					pass.end();
				}
				if (viewChanged || changed(previousResponseValues, responseValues)) {
					responseUniformValues.set({ calibrateFrontView: responseValues[0], brightness: responseValues[1] });
					device.queue.writeBuffer(responseUniformBuffer, 0, responseUniformValues.arrayBuffer);
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, calibratedResponseView);
					pass.setPipeline(responsePipeline);
					pass.setBindGroup(0, responseGroup);
					pass.draw(3);
					pass.end();
				}
				previousOpticalValues = opticalValues;
				previousViewValues = viewValues;
				previousResponseValues = responseValues;
				const output = ctx.outputDataMap.output.texture;
				const variant = imagePipelines.update({ input: params.input, amount: params.amount }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, imageGroup);
				pass.setBindGroup(imagePipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				imagePipelines.dispose();
				frontUniformBuffer.destroy();
				viewUniformBuffer.destroy();
				responseUniformBuffer.destroy();
				spectralBuffer.destroy();
				frontResponse.destroy();
				viewResponse.destroy();
				calibratedResponse.destroy();
			},
		};
	},
});
