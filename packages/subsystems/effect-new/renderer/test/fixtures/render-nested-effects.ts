import { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { ParameterDefinition_Color } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffect, CustomShaderEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createEffectRenderInstance } from '../../src/create-effect-render-instance.ts';

const colorParameter = {
	dataType: { kind: 'color' }, ui: { label: 'Color', control: { controlType: 'color' } },
	defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
} satisfies ParameterDefinition_Color;
const colorOutput = { dataType: { kind: 'color' } } as const;
const scalarOutput = { dataType: { kind: 'scalar' } } as const;
const mainPorts = { primaryInputId: null, primaryAudioInputId: null, primaryOutputId: 'image' };

const customShaderEffect: CustomShaderEffect = {
	...mainPorts, paramDefs: { 'input-id': { ...colorParameter, canNode: true } },
	outputDefs: { image: colorOutput, 'field-id': scalarOutput },
	inputNames: { 'input-id': 'paint' }, outputNames: { image: 'tint', 'field-id': 'field' },
	code: 'fn main(p: vec2f) -> Output { return Output(read_paint(p), get_time() + p.x + p.y); }',
};
const child: CustomNodeGraphEffect = {
	...mainPorts, paramDefs: { color: colorParameter }, outputDefs: customShaderEffect.outputDefs,
	nodes: [
		{ id: 'paint', effect: { type: 'nativeEffect', id: 'solidColor' }, params: { color: { type: 'publicParameter', parameterId: 'color' } } },
		{ id: 'shader', effect: { type: 'customShaderEffectReference', id: 'shader' }, params: { 'input-id': { type: 'nodeOutput', nodeId: 'paint', outputId: 'color' } } },
	],
	outputs: {
		image: { type: 'nodeOutput', nodeId: 'shader', outputId: 'image' },
		'field-id': { type: 'nodeOutput', nodeId: 'shader', outputId: 'field-id' },
	},
};
const parent: CustomNodeGraphEffect = {
	...mainPorts, paramDefs: {}, outputDefs: { image: colorOutput, field: scalarOutput, other: colorOutput },
	nodes: [
		{ id: 'first', effect: { type: 'customNodeGraphEffectReference', id: 'child' }, resolution: { width: 4, height: 2 },
			params: { color: { type: 'value', binding: { inputSource: 'literal', value: [4, -1, 2, 0.5] } } } },
		{ id: 'second', effect: { type: 'customNodeGraphEffectReference', id: 'child' }, resolution: { width: 1, height: 2 },
			params: { color: { type: 'value', binding: { inputSource: 'literal', value: [1, 2, -1, 0.25] } } } },
	],
	outputs: {
		image: { type: 'nodeOutput', nodeId: 'first', outputId: 'image' },
		field: { type: 'nodeOutput', nodeId: 'first', outputId: 'field-id' },
		other: { type: 'nodeOutput', nodeId: 'second', outputId: 'image' },
	},
};

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const source = { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: parent } as const;
	const instanceFor = (shader: CustomShaderEffect) => {
		const catalog = new EffectCatalog({
			customShaderEffects: new Map([['shader', shader]]), customNodeGraphEffects: new Map([['child', child]]),
		});
		catalog.validate(source);
		return createEffectRenderInstance(catalog, source, { device }, { resolution: { width: 8, height: 8 } });
	};
	const instance = instanceFor(customShaderEffect);
	const invalidInstance = instanceFor({ ...customShaderEffect, code: 'fn main(p: vec2f) -> Output { return unknown_symbol; }' });
	const readback = device.createBuffer({ size: 768, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	try {
		const outputIds = new Set(['image', 'field', 'other']);
		await instance.prepare(outputIds);
		const commandEncoder = device.createCommandEncoder();
		const outputs = instance.render({ commandEncoder, parameters: new Map(), time: 3, outputIds });
		const sizes = [];
		for (const [index, id] of [...outputIds].entries()) {
			const output = outputs.get(id);
			if (output?.kind !== 'texture') throw new Error(`Missing texture for ${id}`);
			sizes.push([output.texture.width, output.texture.height]);
			commandEncoder.copyTextureToBuffer({ texture: output.texture }, { buffer: readback, offset: index * 256 }, [1, 1]);
		}
		device.queue.submit([commandEncoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const data = readback.getMappedRange();
		const first = Array.from(new Float16Array(data, 0, 4));
		const field = new Float16Array(data, 256, 1)[0];
		const second = Array.from(new Float16Array(data, 512, 4));
		readback.unmap();
		let diagnostic = '';
		const invalidOutputs = new Set(['image']);
		try {
			await invalidInstance.prepare(invalidOutputs);
		} catch (error) {
			diagnostic = String(error);
		}
		let renderDiagnostic = '';
		try {
			invalidInstance.render({ commandEncoder: device.createCommandEncoder(), parameters: new Map(), time: 3, outputIds: invalidOutputs });
		} catch (error) {
			renderDiagnostic = String(error);
		}
		const gpuError = await device.popErrorScope();
		if (gpuError != null) throw new Error(gpuError.message);
		return { first, field, second, sizes, diagnostic, renderDiagnostic };
	} finally {
		readback.destroy();
		invalidInstance.destroy();
		instance.destroy();
		device.destroy();
	}
}
