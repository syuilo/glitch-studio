import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/types.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/types.ts';
import type { EffectCatalog, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';

const doubleScalar: CustomShaderEffect = {
	kind: 'modify', shaderApiVersion: 1,
	paramDefs: {
		quantity: {
			dataType: { kind: 'scalar' }, nameForReference: 'source', canNode: true,
			ui: { label: 'Quantity', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	outputDefs: { doubled: { dataType: { kind: 'scalar' }, nameForReference: 'result' } },
	primaryInputId: 'quantity', primaryOutputId: 'doubled',
	code: 'fn main(position: vec2f) -> Output { return Output(2.0 * read_source(position)); }',
};

const split: CustomNodeGraphEffect = {
	kind: 'modify',
	paramDefs: { vector: {
		dataType: { kind: 'vector' }, canNode: true, ui: { label: 'Vector', control: { controlType: 'vector' } },
		defaultValue: { inputSource: 'literal', value: [0, 0] },
	} },
	outputDefs: { first: { dataType: { kind: 'scalar' } }, second: { dataType: { kind: 'scalar' } } },
	primaryInputId: 'vector', primaryOutputId: 'first',
	nodes: [{
		id: 'split', effectSource: { type: 'nativeEffect', id: 'decomposeVector' },
		params: { input: { inputSource: 'publicParameter', parameterId: 'vector' } },
	}],
	outputs: {
		first: { inputSource: 'node', nodeId: 'split', outputPort: 'x' },
		second: { inputSource: 'node', nodeId: 'split', outputPort: 'y' },
	},
};

const source: EffectSource = {
	type: 'inlineCustomNodeGraphEffect',
	customNodeGraphEffect: {
		kind: 'modify', paramDefs: split.paramDefs, outputDefs: split.outputDefs,
		primaryInputId: 'vector', primaryOutputId: 'first',
		nodes: [
			{
				id: 'child', effectSource: { type: 'customNodeGraphEffectReference', id: 'split' },
				params: { vector: { inputSource: 'publicParameter', parameterId: 'vector' } },
			},
			{
				id: 'fromPrimary', effectSource: { type: 'customShaderEffectReference', id: 'double' },
				params: { quantity: { inputSource: 'node', nodeId: 'child', outputPort: 'first' } },
			},
			{
				id: 'fromSecondary', effectSource: { type: 'inlineCustomShaderEffect', customShaderEffect: doubleScalar },
				resolution: { width: 1, height: 2 },
				params: { quantity: { inputSource: 'node', nodeId: 'child', outputPort: 'second' } },
			},
		],
		outputs: {
			first: { inputSource: 'node', nodeId: 'fromPrimary', outputPort: 'doubled' },
			second: { inputSource: 'node', nodeId: 'fromSecondary', outputPort: 'doubled' },
		},
	},
};

async function renderFrames() {
	const catalog: EffectCatalog = {
		nativeEffects: nativeEffectDefinitions,
		customShaderEffects: new Map([['double', doubleScalar]]),
		customNodeGraphEffects: new Map([['split', split]]),
	};
	validateEffectSource(source, catalog);
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('No WebGPU adapter');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	try {
		const instance = createEffectInstance(source, { catalog, nativeEffectImplementations, device, resolution: { width: 3, height: 2 }, enable32bitDataTextures: false });
		const input = device.createTexture({ size: [1, 1], format: 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const readback = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			device.queue.writeTexture({ texture: input }, new Float16Array([1.5, -2.5]), {}, [1, 1]);
			const ports = ['first', 'second'];
			const frames = [];
			for (const vector of [[-2, 0.5], { kind: 'texture', texture: input }]) {
				const commandEncoder = device.createCommandEncoder();
				const outputs = await instance.render({ time: 0, timeDelta: 0, commandEncoder, params: { vector }, requestedOutputIds: new Set(ports) });
				for (const [index, port] of ports.entries()) {
					const output = outputs.get(port);
					if (output?.kind !== 'texture') throw new Error(`Missing texture for ${port}`);
					commandEncoder.copyTextureToBuffer({ texture: output.texture }, { buffer: readback, offset: index * 4 }, [1, 1]);
				}
				device.queue.submit([commandEncoder.finish()]);
				await readback.mapAsync(GPUMapMode.READ);
				const values = new Float16Array(readback.getMappedRange());
				frames.push([values[0], values[2]]);
				readback.unmap();
			}
			const error = await device.popErrorScope();
			if (error != null) throw new Error(error.message);
			return { frames, resolutions: ports.map(port => instance.getOutputResolution(port)) };
		} finally {
			readback.destroy();
			input.destroy();
			instance.dispose();
		}
	} finally {
		device.destroy();
	}
}

try {
	await fetch('/result', { method: 'POST', body: JSON.stringify(await renderFrames()) });
} catch (error) {
	await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }) });
}
