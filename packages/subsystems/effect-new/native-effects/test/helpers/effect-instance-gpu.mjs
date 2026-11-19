import vertex from '@gs/shared/gpu/vertex.wgsl';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../../src/definitions.ts';
import { nativeEffectImplementations } from '../../src/implementations.ts';

async function checkNestedGraph(environment, customShaderEffect, resolution) {
	const fromNode = (nodeId, outputPort) => ({ inputSource: 'node', nodeId, outputPort });
	const fromPublic = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
	const nestedGraph = {
		kind: 'modify', primaryInputParameter: 'source', primaryOutput: 'image', resolutionInputParameters: ['source'],
		paramDefs: { source: customShaderEffect.paramDefs.imageId },
		outputDefs: { image: { dataType: { kind: 'color' } }, amount: { dataType: { kind: 'scalar' } } },
		nodes: [{ id: 'splitter', effectSource: { type: 'customShaderEffectReference', id: 'split' },
			params: { imageId: fromPublic('source'), gainId: { inputSource: 'literal', value: 3 } } }],
		outputs: { image: fromNode('splitter', 'colorId'), amount: fromNode('splitter', 'dataId') },
	};
	const branchSource = { type: 'inlineCustomShaderEffect', customShaderEffect };
	const passThroughGraph = {
		kind: 'modify', primaryInputParameter: 'image', primaryOutput: 'output', resolutionInputParameters: ['image'],
		paramDefs: { image: customShaderEffect.paramDefs.imageId },
		outputDefs: { output: { dataType: { kind: 'color' } } },
		nodes: [], outputs: { output: fromPublic('image') },
	};
	const rootGraph = {
		kind: 'generate', primaryInputParameter: null, primaryOutput: null, resolutionInputParameters: [],
		paramDefs: { fillColor: nativeEffectDefinitions.get('fill').paramDefs.color },
		outputDefs: { first: { dataType: { kind: 'scalar' } }, second: { dataType: { kind: 'scalar' } } },
		// 保存順と実行順を逆にし、外側の異なる消費者が同じ子の異なるポートを要求するようにする。
		nodes: [
			{ id: 'firstBranch', effectSource: branchSource,
				params: { imageId: fromNode('passThrough', 'output'), gainId: { inputSource: 'literal', value: 2 } } },
			{ id: 'secondBranch', effectSource: branchSource, params: { gainId: fromNode('nested', 'amount') } },
			// 入力を直結する子を経ても、firstBranchはsplitterの画像を読み、GPUの描画は4パスで済む。
			{ id: 'passThrough', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: passThroughGraph },
				params: { image: fromNode('nested', 'image') } },
			{ id: 'nested', effectSource: { type: 'customNodeGraphEffectReference', id: 'publishedGraph' },
				params: { source: fromNode('fill', 'output') } },
			{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, params: { color: fromPublic('fillColor') } },
		],
		outputs: { first: fromNode('firstBranch', 'dataId'), second: fromNode('secondBranch', 'dataId') },
	};
	const rootSource = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: rootGraph };
	const catalog = { ...environment.catalog, getCustomNodeGraphEffect: id => id === 'publishedGraph' ? nestedGraph : null };
	validateEffectSource(rootSource, catalog);
	// r16floatで中間結果を読み取る。32bitテクスチャのfiltering用のオプション機能を要求しない。
	const gpu = { ...environment.gpu, enable32bitDataTextures: false };
	const instance = await createEffectInstance(rootSource, { resolution, requestedOutputIds: ['second', 'first'],
		inputLayouts: { fillColor: { kind: 'value' } } }, { ...environment, catalog, gpu });
	const readback = gpu.device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const nestedPixels = [];
	const renderPassCounts = [];
	try {
		// 内部のCustom Shader Effectが描くテクスチャを、初回のrenderより先に配線する。
		const firstTexture = instance.outputs.first.source.read().texture;
		const secondTexture = instance.outputs.second.source.read().texture;
		for (const red of [0.75, 0.5]) {
			const encoder = gpu.device.createCommandEncoder();
			let passes = 0;
			const beginRenderPass = encoder.beginRenderPass.bind(encoder);
			encoder.beginRenderPass = descriptor => {
				passes++;
				return beginRenderPass(descriptor);
			};
			instance.render({ time: 0, commandEncoder: encoder, parameters: { fillColor: [red, 0, 0, 0.5] } });
			encoder.copyTextureToBuffer({ texture: firstTexture }, { buffer: readback }, resolution);
			encoder.copyTextureToBuffer({ texture: secondTexture }, { buffer: readback, offset: 4 }, resolution);
			gpu.device.queue.submit([encoder.finish()]);
			await readback.mapAsync(GPUMapMode.READ);
			const pixels = new Float16Array(readback.getMappedRange());
			nestedPixels.push([pixels[0], pixels[2]]);
			renderPassCounts.push(passes);
			readback.unmap();
		}
		return { nestedPixels, renderPassCounts };
	} finally {
		readback.destroy();
		instance.dispose();
	}
}

export async function checkEffectInstances() {
	const adapter = await navigator.gpu.requestAdapter();
	const device = await adapter.requestDevice();
	const gpu = { device, enable32bitDataTextures: true, defaultVertexShaderModule: device.createShaderModule({ code: vertex }) };
	const resolution = { width: 1, height: 1 };
	const customShaderEffect = {
		kind: 'modify', shaderApiVersion: 1, codeLanguage: 'wgsl',
		paramDefs: {
			gainId: { nameForReference: 'gain', dataType: { kind: 'scalar' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
			imageId: { nameForReference: 'image', dataType: { kind: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		},
		outputDefs: {
			colorId: { nameForReference: 'color', dataType: { kind: 'color' } },
			dataId: { nameForReference: 'result', dataType: { kind: 'scalar' } },
		},
		primaryInputParameter: 'imageId', primaryOutput: 'colorId', resolutionInputParameters: ['imageId'],
		code: `fn main(position: vec2f) -> Output {
	var output: Output;
	output.color = read_image(position);
	output.result = output.color.r + read_gain(position);
	return output;
}`,
	};
	const environment = {
		gpu, getNativeEffectImplementation: id => nativeEffectImplementations.get(id) ?? null,
		catalog: {
			getNativeEffectDefinition: id => nativeEffectDefinitions.get(id) ?? null,
			getCustomShaderEffect: id => id === 'split' ? customShaderEffect : null,
			getCustomNodeGraphEffect: () => null,
		},
	};
	const options = { resolution, requestedOutputIds: ['dataId'], inputLayouts: { gainId: { kind: 'uniform' }, imageId: { kind: 'texture', resolution } } };
	const inputTexture = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	let instance = null;
	try {
		instance = await createEffectInstance({ type: 'customShaderEffectReference', id: 'split' }, options, environment);
		if (Object.keys(instance.outputs).join() !== 'dataId') throw new Error('Allocated an unused output');
		const dataOutput = instance.outputs.dataId;
		const dataTexture = dataOutput.source.read().texture;
		const pixels = [];
		const image = { kind: 'texture', texture: inputTexture, fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' };
		for (const [red, gain] of [[255, 2], [0, -1]]) {
			device.queue.writeTexture({ texture: inputTexture }, new Uint8Array([red, 0, 0, 255]), {}, resolution);
			const encoder = device.createCommandEncoder();
			instance.render({ commandEncoder: encoder, time: 0, parameters: { gainId: { kind: 'uniform', value: [gain] }, imageId: image } });
			encoder.copyTextureToBuffer({ texture: dataTexture }, { buffer: readback }, resolution);
			device.queue.submit([encoder.finish()]);
			await readback.mapAsync(GPUMapMode.READ);
			pixels.push(new Float32Array(readback.getMappedRange())[0]);
			readback.unmap();
		}
		let inputChangeError = null;
		try {
			instance.render({ commandEncoder: device.createCommandEncoder(), time: 0, parameters: { gainId: image, imageId: image } });
		} catch (error) {
			inputChangeError = error.message;
		}
		let compilerError = null;
		try {
			const invalidShader = { ...customShaderEffect, code: 'fn main(position: vec2f) -> Output {\n return missing_name;\n}' };
			await createEffectInstance({ type: 'inlineCustomShaderEffect', customShaderEffect: invalidShader }, options, environment);
		} catch (error) {
			compilerError = error.message;
		}
		const nestedResult = await checkNestedGraph(environment, customShaderEffect, resolution);
		return { pixels, outputLayouts: { dataId: dataOutput.layout }, inputChangeError, compilerError, ...nestedResult };
	} finally {
		instance?.dispose();
		inputTexture.destroy();
		readback.destroy();
		device.destroy();
	}
}
