import vertex from '@gs/shared/gpu/vertex.wgsl';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';

const size = { width: 4, height: 2 };
const color = name => ({ nameForReference: name, dataType: { kind: 'color' }, canNode: true,
	ui: { label: name, control: {} }, defaultValue: [0, 0, 0, 0] });
const output = name => ({ dataType: { kind: 'color' }, nameForReference: name });
const base = { kind: 'modify', primaryInputParameter: 'image', primaryOutput: 'main', resolutionInputParameters: [], paramDefs: { image: color('image') }, outputDefs: { main: output('mainColor') } };
const wire = (nodeId, outputPort) => ({ inputSource: 'node', source: { nodeId, outputPort }, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } });
const parameter = parameterId => ({ inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId });
const shader = { ...base, shaderApiVersion: 1, paramDefs: { image: color('image'), gain: color('gain') },
	outputDefs: { unused: output('unused'), main: output('mainColor'), aux: output('aux') },
	code: 'fn main(p: vec2f) -> Output { return Output(vec4f(0), read_image(p), read_gain(p)); }' };
const child = { ...base, nodes: [
	{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, params: { color: { inputSource: 'literal', value: [2, 0.5, -1, 0.5] } } },
	{ id: 'split', effectSource: { type: 'customShaderEffectReference', id: 'split' }, params: { image: wire('fill', 'output'), gain: parameter('image') } },
], outputDefs: { main: output('mainColor'), aux: output('aux') }, outputSources: { main: { nodeId: 'split', outputPort: 'main' }, aux: { nodeId: 'split', outputPort: 'aux' } } };
const parent = { ...base, nodes: [
	{ id: 'child', effectSource: { type: 'customNodeGraphEffectReference', id: 'child' }, params: { image: parameter('image') } },
	{ id: 'combine', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: { ...base, shaderApiVersion: 1,
		paramDefs: { a: color('a'), b: color('b') }, primaryInputParameter: 'a',
		code: 'fn main(p: vec2f) -> Output { return Output(read_a(p) + read_b(p)); }' } }, params: { a: wire('child', 'main'), b: wire('child', 'aux') } },
], outputSources: { main: { nodeId: 'combine', outputPort: 'main' } } };

export async function run(mismatchedPorts = false) {
	const adapter = await navigator.gpu.requestAdapter();
	const device = await adapter.requestDevice();
	const scalarImage = { ...color('image'), dataType: { kind: 'scalar' }, defaultValue: 0 };
	const scalarOutput = { ...output('aux'), dataType: { kind: 'scalar' } };
	const splitShader = mismatchedPorts ? { ...shader, outputDefs: { ...shader.outputDefs, aux: scalarOutput },
		code: 'fn main(p: vec2f) -> Output { let gain = read_gain(p); return Output(vec4f(0), read_image(p) + vec4f(0, gain.gba), gain.r); }' } : shader;
	const childGraph = mismatchedPorts ? { ...child, paramDefs: { image: scalarImage }, outputDefs: { ...child.outputDefs, aux: scalarOutput } } : child;
	const parentGraph = mismatchedPorts ? { ...parent, paramDefs: { image: scalarImage } } : parent;
	const definitions = { getNativeEffect: id => nativeEffectDefinitions[id], getCustomShaderEffect: () => splitShader, getCustomNodeGraphEffect: () => childGraph };
	const effectSource = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: parentGraph };
	validateEffectSource(effectSource, definitions);
	let gain = 0.5;
	const instance = await createEffectInstance({ effectSource, definitions, resolution: size, usedOutputPorts: new Set(['main']),
		inputs: { image: { kind: 'uniform', get value() { return mismatchedPorts ? [gain] : [gain, gain, gain, gain]; } } } },
	{ device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }), enable32bitDataTextures: false }, id => nativeEffectImplementations[id]);
	const pixel = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
	const staging = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	try {
		const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: device.createShaderModule({ code: `
			@group(0) @binding(0) var image: texture_2d<f32>;
			@group(0) @binding(1) var<storage, read_write> pixel: vec4f;
			@compute @workgroup_size(1) fn sample_pixel() { pixel = textureLoad(image, vec2u(0), 0); }
		` }) } });
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
			{ binding: 0, resource: instance.outputs.get('main').texture.createView() }, { binding: 1, resource: { buffer: pixel } },
		] });
		const pixels = [];
		for (const value of [0.5, 1]) {
			gain = value;
			const commandEncoder = device.createCommandEncoder();
			instance.render({ commandEncoder, time: value, timeDelta: 0 });
			const pass = commandEncoder.beginComputePass();
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.dispatchWorkgroups(1);
			pass.end();
			commandEncoder.copyBufferToBuffer(pixel, 0, staging, 0, 16);
			device.queue.submit([commandEncoder.finish()]);
			await staging.mapAsync(GPUMapMode.READ);
			pixels.push(Array.from(new Float32Array(staging.getMappedRange())));
			staging.unmap();
		}
		return { pixels };
	} finally {
		instance.dispose();
		staging.destroy();
		pixel.destroy();
		device.destroy();
	}
}
