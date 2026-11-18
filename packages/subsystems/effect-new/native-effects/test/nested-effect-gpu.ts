import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/types.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/types.ts';
import type { EffectCatalog, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectInstance } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

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

async function readPreparedOutputs(device: GPUDevice, instance: EffectInstance, ports: string[], readback: GPUBuffer): Promise<number[]> {
	const commandEncoder = device.createCommandEncoder();
	const outputs = instance.render(commandEncoder);
	for (const [index, port] of ports.entries()) {
		const output = outputs.get(port);
		if (output?.kind !== 'texture') throw new Error(`Missing texture for ${port}`);
		commandEncoder.copyTextureToBuffer({ texture: output.texture }, { buffer: readback, offset: index * 4 }, [1, 1]);
	}
	device.queue.submit([commandEncoder.finish()]);
	await readback.mapAsync(GPUMapMode.READ);
	const values = new Float16Array(readback.getMappedRange());
	const pixels = ports.map((_, index) => values[index * 2]);
	readback.unmap();
	return pixels;
}

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
		const options = { catalog, nativeEffectImplementations, device, resolution: { width: 3, height: 2 }, enable32bitDataTextures: false };
		const instance = createEffectInstance(source, options);
		const shader = createEffectInstance({ type: 'customShaderEffectReference', id: 'double' }, options);
		const invalidShader = createEffectInstance({
			type: 'inlineCustomShaderEffect', customShaderEffect: { ...doubleScalar, code: 'fn main(position: vec2f) -> Output { return missing_function(); }' },
		}, options);
		const input = device.createTexture({ size: [1, 1], format: 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const readback = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			device.queue.writeTexture({ texture: input }, new Float16Array([1.5, -2.5]), {}, [1, 1]);
			const ports = ['first', 'second'];
			const frames = [];
			for (const vector of [[-2, 0.5], { kind: 'texture', texture: input }]) {
				instance.prepare({ time: 0, timeDelta: 0, params: { vector }, requestedOutputIds: new Set(ports) });
				if (!instance.checkReady() && !await instance.waitUntilReady()) throw new Error('Graph frame was superseded');
				frames.push(await readPreparedOutputs(device, instance, ports, readback));
			}

			// 定数入力のコンパイル中にテクスチャへ切り替える。古い待機者は描画せず、
			// 新しい配置の準備が済んだ時点で初めてコマンドを記録する。
			const shaderPorts = ['doubled'];
			const shaderFrame = { time: 0, timeDelta: 0, requestedOutputIds: new Set(shaderPorts) };
			shader.prepare({ ...shaderFrame, params: { quantity: 0.5 } });
			if (shader.checkReady()) throw new Error('First shader variant reported ready before compilation');
			const firstPreparation = shader.waitUntilReady();
			shader.prepare({ ...shaderFrame, params: { quantity: { kind: 'texture', texture: input } } });
			if (shader.checkReady()) throw new Error('Texture variant reported ready before compilation');
			if (await firstPreparation) throw new Error('Superseded shader frame reported ready');
			if (!await shader.waitUntilReady() || !shader.checkReady()) throw new Error('Texture variant did not become ready');
			const shaderFrames = [await readPreparedOutputs(device, shader, shaderPorts, readback)];

			shader.prepare({ ...shaderFrame, params: { quantity: -3 } });
			if (!await shader.waitUntilReady()) throw new Error('Uniform variant did not become ready');
			shaderFrames.push(await readPreparedOutputs(device, shader, shaderPorts, readback));
			// 同じ入力構成で値だけ更新すると、前回準備済みの pipeline を同期描画にそのまま使える。
			shader.prepare({ ...shaderFrame, params: { quantity: 4 } });
			if (!shader.checkReady()) throw new Error('Changing only uniform values triggered another wait');
			shaderFrames.push(await readPreparedOutputs(device, shader, shaderPorts, readback));

			invalidShader.prepare({ ...shaderFrame, params: {} });
			let compilationError: string | null = null;
			try {
				await invalidShader.waitUntilReady();
			} catch (cause) {
				compilationError = cause instanceof Error ? cause.message : String(cause);
			}
			const error = await device.popErrorScope();
			if (error != null) throw new Error(error.message);
			return { frames, shaderFrames, compilationError, resolutions: ports.map(port => instance.getOutputResolution(port)) };
		} finally {
			invalidShader.dispose();
			shader.dispose();
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
