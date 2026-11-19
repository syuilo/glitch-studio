import vertex from '@gs/shared/gpu/vertex.wgsl';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../../src/definitions.ts';
import { nativeEffectImplementations } from '../../src/implementations.ts';

const sampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' };
const colorParameter = {
	id: 'paint', nameForReference: 'paint', dataType: { kind: 'color' }, canNode: false,
	ui: { label: 'Paint', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
};
const paint = { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: colorParameter.id };

function parameter(id, kind) {
	return {
		id, nameForReference: id, dataType: { kind }, canNode: true,
		ui: { label: id, control: kind === 'scalar' ? { controlType: 'number' } : {} },
		defaultValue: { inputSource: 'literal', value: kind === 'scalar' ? 0 : [0, 0, 0, 0] },
	};
}
function port(id, kind) {
	return { id, name: id, label: id, nameForReference: id, dataType: { kind } };
}
function graph(nodes, outputs) {
	return {
		kind: 'generate', nodes, outputDefs: outputs, paramDefs: [colorParameter], primaryInputId: null, primaryOutputId: null,
		customParameterDefs: [], customParameterValues: {}, automationGraphs: [],
	};
}
function shader(paramDefs, outputDefs, code) {
	return { shaderApiVersion: 1, codeLanguage: 'wgsl', code, kind: 'modify', paramDefs, outputDefs, primaryInputId: null, primaryOutputId: null, resolutionInputIds: [] };
}
function node(id, effectSource, params) {
	return { id, type: 'effect', effectSource, params, isBypass: false, resolution: { mode: 'context', scale: 1 }, staticSettings: {}, displayName: id };
}
function connect(nodeId, outputPort) {
	return { inputSource: 'node', nodeId, outputPort, ...sampling };
}

export async function run() {
	const split = shader([parameter('source', 'color')], [port('red', 'scalar'), port('rest', 'color')], `
		fn main(p: vec2f) -> Output {
			let color = read_source(p);
			return Output(color.r, vec4f(0, color.gba));
		}`);
	const combine = shader([parameter('red', 'scalar'), parameter('rest', 'color')], [port('result', 'color')], `
		fn main(p: vec2f) -> Output {
			return Output(vec4f(read_red(p), read_rest(p).gba));
		}`);
	const child = graph([
		node('fill', { type: 'nativeEffect', id: 'fill' }, { color: paint }),
		node('split', { type: 'customShaderEffectReference', id: 'split' }, { source: connect('fill', 'output') }),
		{ id: 'out', type: 'globalOut', inputs: { red: { nodeId: 'split', outputPort: 'red' }, rest: { nodeId: 'split', outputPort: 'rest' } } },
	], [port('red', 'scalar'), port('rest', 'color')]);
	const parent = graph([
		node('child', { type: 'customNodeGraphEffectReference', id: 'child' }, { paint }),
		node('combine', { type: 'inlineCustomShaderEffect', customShaderEffect: combine }, { red: connect('child', 'red'), rest: connect('child', 'rest') }),
		{ id: 'out', type: 'globalOut', inputs: { frame: { nodeId: 'combine', outputPort: 'result' } } },
	], [port('frame', 'color')]);
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: parent };
	const catalog = { nativeEffects: nativeEffectDefinitions, customShaderEffects: new Map([['split', split]]), customNodeGraphEffects: new Map([['child', child]]) };
	validateEffectSource(source, catalog);
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('No WebGPU adapter');
	const device = await adapter.requestDevice();
	const readback = device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
	const pixels = [];
	let instance = null;
	try {
		device.pushErrorScope('validation');
		const colors = [[4, -0.5, 2, 0.5], [1, 0.25, -1, 0.25]];
		instance = await createEffectInstance(source, {
			gpu: { device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }), enable32bitDataTextures: false },
			resolution: { width: 4, height: 2 }, usedOutputPorts: new Set(['frame']), staticSettings: {},
			inputs: { paint: { kind: 'value', read: frame => colors[frame.time] } },
		}, { catalog, nativeImplementations: nativeEffectImplementations });
		for (const time of [0, 1]) {
			const commandEncoder = device.createCommandEncoder();
			const frame = { commandEncoder, time, endTime: 2, timeDelta: time * 1000, isExport: true };
			instance.render(frame);
			const output = instance.outputs.frame.read(frame);
			commandEncoder.copyTextureToBuffer({ texture: output.texture }, { buffer: readback }, [1, 1, 1]);
			device.queue.submit([commandEncoder.finish()]);
			await readback.mapAsync(GPUMapMode.READ);
			pixels.push(Array.from(new Float16Array(readback.getMappedRange())));
			readback.unmap();
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return pixels;
	} finally {
		instance?.dispose();
		readback.destroy();
		device.destroy();
	}
}
