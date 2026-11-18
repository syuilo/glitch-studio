import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { EffectInstance } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/custom-node-graph-effect.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/custom-shader-effect.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';

const multiply: CustomShaderEffect = {
	kind: 'modify', codeLanguage: 'wgsl', shaderApiVersion: 1,
	paramDefs: {
		image: { dataType: { kind: 'color' }, nameForReference: 'image', canNode: true,
			ui: { label: 'Image', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		gain: { dataType: { kind: 'scalar' }, nameForReference: 'gain', canNode: true,
			ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	outputDefs: {
		image: { dataType: { kind: 'color' }, nameForReference: 'color' },
		channel: { dataType: { kind: 'scalar' }, nameForReference: 'red' },
	},
	primaryInputParameter: 'image', primaryOutput: 'image', resolutionInputParameters: ['image'],
	code: `fn main(position: vec2f) -> Output {
		let color = read_image(position);
		return Output(vec4f(color.rgb * read_gain(position), color.a), color.r);
	}`,
};

const child: CustomNodeGraphEffect = {
	kind: 'generate', primaryInputParameter: null, primaryOutput: 'image', resolutionInputParameters: [],
	paramDefs: {}, outputDefs: multiply.outputDefs,
	nodes: [
		{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, resolution: { width: 4, height: 2 },
			params: { color: { inputSource: 'literal', value: [4, -1, 0.5, 0.5] } } },
		{ id: 'split', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: multiply },
			params: { image: { inputSource: 'node', nodeId: 'fill', outputPort: 'output' } } },
	],
	outputs: {
		image: { inputSource: 'node', nodeId: 'split', outputPort: 'image' },
		channel: { inputSource: 'node', nodeId: 'split', outputPort: 'channel' },
	},
};

const registeredShader = { type: 'customShaderEffectReference', id: 'multiply' } as const;
const parent: EffectSource = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: {
	kind: 'generate', primaryInputParameter: null, primaryOutput: 'original', resolutionInputParameters: [],
	paramDefs: {}, outputDefs: { original: { dataType: { kind: 'color' } }, grayscale: { dataType: { kind: 'color' } } },
	nodes: [
		{ id: 'child', effectSource: { type: 'customNodeGraphEffectReference', id: 'child' }, params: {} },
		{ id: 'original', effectSource: registeredShader, params: { image: { inputSource: 'node', nodeId: 'child', outputPort: 'image' } } },
		{ id: 'grayscale', effectSource: registeredShader, params: { gain: { inputSource: 'node', nodeId: 'child', outputPort: 'channel' } } },
	],
	outputs: {
		original: { inputSource: 'node', nodeId: 'original', outputPort: 'image' },
		grayscale: { inputSource: 'node', nodeId: 'grayscale', outputPort: 'image' },
	},
} };

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('No WebGPU adapter');
	const device = await adapter.requestDevice();
	const catalog = { nativeEffects: nativeEffectDefinitions, nativeEffectImplementations,
		customNodeGraphEffects: new Map([['child', child]]), customShaderEffects: new Map([['multiply', multiply]]) };
	const options = { device, resolution: { width: 9, height: 3 }, inputKinds: {} };
	const buffer = device.createBuffer({ size: 1280, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
	const transparent = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	let instance: EffectInstance | null = null;
	let textureInstance: EffectInstance | null = null;
	let uniformInstance: EffectInstance | null = null;
	try {
		validateEffectSource(parent, catalog);
		instance = await createEffectInstance(parent, options, catalog);
		device.pushErrorScope('validation');
		const ids = ['original', 'grayscale'];
		const encoder = device.createCommandEncoder();
		const outputs = instance.render({ commandEncoder: encoder, params: {}, requestedOutputIds: new Set(ids), time: 0, timeDelta: 0 });
		for (const [index, id] of ids.entries()) {
			const value = outputs.get(id);
			if (value?.kind !== 'texture') throw new Error(`Missing texture: ${id}`);
			encoder.copyTextureToBuffer({ texture: value.texture }, { buffer, offset: index * 256 }, [1, 1]);
		}
		device.queue.submit([encoder.finish()]);
		// 動画サンプルのない先頭フレームは共有の透明テクスチャで表し、次のフレームに実画像を渡す。
		// 値やテクスチャを差し替えても、この配置のpipelineと描画履歴はそのまま使える。
		const shaderOptions = { ...options, inputKinds: { image: 'texture', gain: 'uniform' } } as const;
		textureInstance = await createEffectInstance(registeredShader, shaderOptions, catalog);
		const original = outputs.get('original');
		if (original?.kind !== 'texture') throw new Error('Missing original image');
		function drawSample(shader: EffectInstance, params: Readonly<Record<string, ShaderInput>>, index: number) {
			const shaderEncoder = device.createCommandEncoder();
			const values = shader.render({
				commandEncoder: shaderEncoder, requestedOutputIds: new Set(['image']), time: index, timeDelta: 0,
				params,
			});
			const value = values.get('image');
			if (value?.kind !== 'texture') throw new Error('Missing shader output');
			shaderEncoder.copyTextureToBuffer({ texture: value.texture }, { buffer, offset: index * 256 }, [1, 1]);
			device.queue.submit([shaderEncoder.finish()]);
		}
		const sampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } as const;
		drawSample(textureInstance, { image: textureShaderInput(transparent, sampling), gain: { kind: 'uniform', value: [1] } }, 2);
		drawSample(textureInstance, { image: textureShaderInput(original.texture, sampling), gain: { kind: 'uniform', value: [0.5] } }, 3);

		// 公開入力数がサンプラー上限を超えても、全てuniformであればGPUの準備・描画が成功する。
		const gainInputs = Array.from({ length: device.limits.maxSamplersPerShaderStage + 1 }, (_, i) => 'gain' + i);
		const manyInputs: CustomShaderEffect = { ...multiply, paramDefs: {
			...multiply.paramDefs,
			...Object.fromEntries(gainInputs.map(id => [id, { ...multiply.paramDefs.gain, nameForReference: id }])),
		} };
		const inputKinds = Object.fromEntries(Object.keys(manyInputs.paramDefs).map(id => [id, 'uniform' as const]));
		uniformInstance = await createEffectInstance({ type: 'inlineCustomShaderEffect', customShaderEffect: manyInputs }, { ...options, inputKinds }, catalog);
		drawSample(uniformInstance, {
			...Object.fromEntries(gainInputs.map(id => [id, { kind: 'uniform', value: [1] } as const])),
			image: { kind: 'uniform', value: [3, 1, 0, 1] }, gain: { kind: 'uniform', value: [0.5] },
		}, 4);
		const validation = await device.popErrorScope();
		if (validation != null) throw new Error(validation.message);
		await buffer.mapAsync(GPUMapMode.READ);
		const pixels = [0, 256, 512, 768, 1024].map(offset => Array.from(new Float16Array(buffer.getMappedRange(offset, 8))));
		buffer.unmap();

		const invalidSource: EffectSource = { type: 'inlineCustomShaderEffect', customShaderEffect: { ...multiply, code: 'fn main(?' } };
		const diagnostic = await createEffectInstance(invalidSource, shaderOptions, catalog).then(unexpected => {
			unexpected.dispose();
			return null;
		}, (error: Error) => error.message);
		return { pixels, resolutions: ids.map(id => instance!.getOutputResolution(id)), diagnostic };
	} finally {
		uniformInstance?.dispose();
		textureInstance?.dispose();
		instance?.dispose();
		transparent.destroy();
		buffer.destroy();
		device.destroy();
	}
}
