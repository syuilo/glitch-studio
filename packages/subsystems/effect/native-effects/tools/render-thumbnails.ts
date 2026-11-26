import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { createExternalImageToLinearTextureConverter } from '@gs/shared/media/external-image-texture.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import vertexShader from '@gs/shared/gpu/vertex.wgsl?raw';
import colorSpaceShader from '@gs/shared/gpu/color-space.wgsl?raw';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';
import thumbnailOutputShader from './thumbnail-output.wgsl?raw';
import sceneAUrl from './samples/scene-a.webp';
import sceneBUrl from './samples/scene-b.webp';
import type { NativeEffectAutomaticThumbnail, NativeEffectDefinition, NativeEffectThumbnailSample } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectPlacementInput } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';

const thumbnailResolution = { width: 300, height: 200 };
const thumbnailFrame = { time: 0, timeDelta: 0 };
const sampleUrls: Record<NativeEffectThumbnailSample, string> = { sceneA: sceneAUrl, sceneB: sceneBUrl };
const definitions: Readonly<Record<string, NativeEffectDefinition>> = nativeEffectDefinitions;
const implementations: Readonly<Record<string, NativeEffectImplementation>> = nativeEffectImplementations;

type NativeEffectThumbnailRequest = { id: string; thumbnail: NativeEffectAutomaticThumbnail };
type NativeEffectThumbnailResult = { id: string; base64: string } | { id: string; error: string };

export async function renderThumbnails(requests: readonly NativeEffectThumbnailRequest[]): Promise<NativeEffectThumbnailResult[]> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter is unavailable.');
	const device = await adapter.requestDevice();
	const sampleTextures = new Map<NativeEffectThumbnailSample, GPUTexture>();
	try {
		const canvas = new OffscreenCanvas(thumbnailResolution.width, thumbnailResolution.height);
		const canvasContext = canvas.getContext('webgpu');
		if (canvasContext == null) throw new Error('WebGPU canvas is unavailable.');
		const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexShader }), enable32bitDataTextures: false };
		const format = 'rgba8unorm';
		const outputPipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: gpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: `${colorSpaceShader}\n${thumbnailOutputShader}` }), targets: [{ format }] },
		});
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		const converter = createExternalImageToLinearTextureConverter(device);
		canvasContext.configure({ device, format, colorSpace: 'srgb', alphaMode: 'premultiplied' });

		async function loadSample(sample: NativeEffectThumbnailSample) {
			const cached = sampleTextures.get(sample);
			if (cached != null) return cached;
			const image = await createImageBitmap(await (await fetch(sampleUrls[sample])).blob());
			try {
				const texture = device.createTexture({
					size: [image.width, image.height], format: INTERMEDIATE_TEXTURE_FORMAT,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				try {
					converter.copy(image, texture);
				} catch (error) {
					texture.destroy();
					throw error;
				}
				sampleTextures.set(sample, texture);
				return texture;
			} finally {
				image.close();
			}
		}

		async function renderThumbnail({ id, thumbnail }: NativeEffectThumbnailRequest, context: GPUCanvasContext): Promise<string> {
			const definition = definitions[id];
			const outputPort = definition.primaryOutput;
			if (outputPort == null) throw new Error('Native Effect needs a primary color output.');
			const primaryInput = definition.primaryInputParameter;
			const inputSamples = thumbnail.inputs ?? (primaryInput != null && definition.paramDefs[primaryInput].dataType.kind === 'color'
				? { [primaryInput]: 'sceneA' as const } : {});
			const inputs: Record<string, EffectPlacementInput> = {};
			for (const [parameterId, sample] of Object.entries(inputSamples)) {
				const texture = await loadSample(sample);
				inputs[parameterId] = { kind: 'texture', texture, resolution: { width: texture.width, height: texture.height } };
			}
			const params = Object.fromEntries(Object.entries(thumbnail.params ?? {}).map(([parameterId, value]) => [
				parameterId, createDefaultParameterBinding({ dataType: definition.paramDefs[parameterId].dataType, defaultValue: value }),
			]));
			const instance = await createEffectInstance({
				effectSource: { type: 'nativeEffect', id },
				definitions: {
					getNativeEffect: nativeEffectId => definitions[nativeEffectId],
					getCustomShaderEffect: () => { throw new Error('Custom Shader Effects are unavailable during Native Effect thumbnail generation.'); },
					getNodesEffect: () => { throw new Error('Nodes Effects are unavailable during Native Effect thumbnail generation.'); },
				},
				resolution: thumbnailResolution, usedOutputPorts: new Set([outputPort]), inputs, params,
			}, gpu, nativeEffectId => implementations[nativeEffectId]);
			try {
				await instance.prepare(thumbnailFrame);
				const encoder = device.createCommandEncoder();
				instance.render(thumbnailFrame, encoder);
				const texture = instance.outputs.get(outputPort)!.texture;
				// 固定寸法を持つ出力も縦横比を保ち、余白を透過で残す。
				const scale = Math.min(canvas.width / texture.width, canvas.height / texture.height);
				const width = texture.width * scale;
				const height = texture.height * scale;
				const pass = encoder.beginRenderPass({
					colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
				});
				pass.setViewport((canvas.width - width) / 2, (canvas.height - height) / 2, width, height, 0, 1);
				pass.setPipeline(outputPipeline);
				pass.setBindGroup(0, device.createBindGroup({ layout: outputPipeline.getBindGroupLayout(0), entries: [
					{ binding: 0, resource: texture.createView() }, { binding: 1, resource: sampler },
				] }));
				pass.draw(3);
				pass.end();
				device.queue.submit([encoder.finish()]);
				const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
				if (webp.type !== 'image/webp') throw new Error(`Chrome could not encode WebP (received ${webp.type}).`);
				return new Uint8Array(await webp.arrayBuffer()).toBase64();
			} finally {
				instance.dispose();
			}
		}

		try {
			const results: NativeEffectThumbnailResult[] = [];
			for (const request of requests) {
				device.pushErrorScope('validation');
				const result = await renderThumbnail(request, canvasContext).then(base64 => ({ id: request.id, base64 }),
					error => ({ id: request.id, error: error instanceof Error ? error.message : String(error) }));
				const validationError = await device.popErrorScope();
				results.push(validationError == null ? result : { id: request.id, error: validationError.message });
			}
			return results;
		} finally {
			canvasContext.unconfigure();
			converter.dispose();
		}
	} finally {
		for (const texture of sampleTextures.values()) texture.destroy();
		device.destroy();
	}
}
