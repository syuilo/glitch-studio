import { EffectRenderer } from '../../src/effect-renderer.ts';
import { VisualModuleRenderer } from '../../src/visual-module-renderer.ts';
import gradientDefinition from '../../../shared/src/effect/fx/gradient/_def_.ts';
import gradient from '../../../shared/src/effect/fx/gradient/_impl_.ts';
import accumulateDefinition from '../../../shared/src/effect/fx/accumulate/_def_.ts';
import accumulate from '../../../shared/src/effect/fx/accumulate/_impl_.ts';
import colorMixDefinition from '../../../shared/src/effect/fx/colorMix/_def_.ts';
import colorMix from '../../../shared/src/effect/fx/colorMix/_impl_.ts';
import { constantShaderInput } from '../../../shared/src/shader-input.ts';
import type { RuntimeEffectParameters } from '../../../shared/src/effect/effect-implementation.ts';
import type { VisualModule, VisualModuleEffectNode } from '../../../shared/src/visual-module/types.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { checkEffectTimelineLayers } from './effect-timeline-layer-gpu.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	// エフェクトの出力はCOPY_SRCを持たない。画素の検証用にだけRGBA8へコピーする。
	// 同一画素を厳密に比較するため、ここでは補間せずtextureLoadで読み取る。
	const pipeline = device.createRenderPipeline({
		layout: 'auto', vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var input: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(input, vec2i(position.xy), 0);
}` }), targets: [{ format: 'rgba8unorm' }] },
		primitive: { topology: 'triangle-list' },
	});
	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const output = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: height * bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(6);
			pass.end();
			encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const bytes = new Uint8Array(buffer.getMappedRange());
			const values = Array.from({ length: height }, (_, row) => Array.from(bytes.slice(row * bytesPerRow, row * bytesPerRow + width * 4))).flat();
			buffer.unmap();
			return values;
		} finally {
			buffer.destroy();
			output.destroy();
		}
	}
	try {
		const completed = await checkEffectRenderers(device, vertex, read);
		completed.push(...await checkEffectTimelineLayers(device, vertex, read));
		const error = await device.popErrorScope();
		if (error) throw new Error(error.message);
		return completed;
	} finally { device.destroy(); }
}

async function checkEffectRenderers(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const completed: string[] = [];
	function check(name: string, actual: number[], expected: number[]) {
		if (actual.length !== expected.length || actual.some((value, index) => Math.abs(value - expected[index]) > 2)) {
			throw new Error(`${name}: ${actual} != ${expected}`);
		}
		completed.push(name);
	}
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const single = new EffectRenderer({
		definition: gradientDefinition, implementation: gradient, resolution: { width: 4, height: 4 }, fallbackTexture,
		wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
	});
	const params = Object.fromEntries(Object.entries(gradientDefinition.paramDefs).map(([key, def]) => [
		key, 'canNode' in def && def.canNode ? constantShaderInput(def.dataType.kind, def.defaultValue.value) : def.defaultValue.value,
	])) as unknown as RuntimeEffectParameters<typeof gradientDefinition.paramDefs>;
	const history: VisualModuleEffectNode = {
		id: 'history', type: 'effect', effectId: 'accumulate', isBypass: false, resolution: { mode: 'context' },
		params: {
			input: { inputSource: 'node', nodeId: 'source', outputPort: 'output', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' },
			strength: { inputSource: 'literal', value: 1 }, halfLife: { inputSource: 'literal', value: 0 }, reset: { inputSource: 'literal', value: false },
		},
	};
	const module: VisualModule = {
		automationGraphs: [], paramDefs: [], primaryInputId: null,
		outputDefs: [{ id: 'out', name: 'out', label: 'Out', dataType: { kind: 'any' } }], primaryOutputId: 'out',
		nodes: [{
			id: 'source', type: 'effect', effectId: 'colorMix', isBypass: false, resolution: { mode: 'context' },
			params: { inputA: { inputSource: 'literal', value: [1, 0, 0, 1] }, inputB: { inputSource: 'literal', value: [0, 0, 0, 0] }, amount: { inputSource: 'literal', value: 0 } },
		}, history, { id: 'out', type: 'globalOut', inputs: { out: { nodeId: 'history', outputPort: 'output' } } }],
	};
	const renderer = new VisualModuleRenderer({
		gpuDevice: device, fallbackTexture, resolution: { width: 4, height: 4 }, enableStats: false, timingHelper: null,
		enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm', assets: [], assetTextures: new Map(), audioSources: new Map(), videoFrames: new Map(), videoFrameVersions: new Map(),
		effectDefinitions: { colorMix: { ...colorMixDefinition }, accumulate: { ...accumulateDefinition } }, effectImplementations: { colorMix, accumulate }, visualModule: module,
	});
	const frame = () => ({ time: 1000, timeDelta: 250, endTime: Infinity, isExport: false, pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 }, evaluatedParamValues: new Map() });
	async function drawModule() {
		const ctx = frame();
		await renderer.prepare(ctx, new AbortController().signal);
		const encoder = device.createCommandEncoder();
		const output = renderer.render(ctx, encoder);
		device.queue.submit([encoder.finish()]);
		if (output?.kind !== 'texture') throw new Error('Expected texture from effect');
		return read(output.texture);
	}
	function drawGradient(ports: ReadonlySet<'scalar' | 'vector'>) {
		single.setUsedOutputPorts(ports);
		single.prepare(params);
		const encoder = device.createCommandEncoder();
		single.render({ params, commandEncoder: encoder, usedOutputPorts: ports, time: 1, timeDelta: 250, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 } });
		device.queue.submit([encoder.finish()]);
	}
	try {
		// 【単体エフェクトの複数出力と遅延確保を実画素で確認する】
		// 実際のGradientのMRTを通し、出力の解放・再確保後にも値と微分が同時に書き込まれることを確認する。
		const scalarOnly = new Set<'scalar' | 'vector'>(['scalar']);
		const both = new Set<'scalar' | 'vector'>(['scalar', 'vector']);
		drawGradient(scalarOnly);
		check('EffectRenderer scalar output', await read(single.getOutputTexture('scalar')!), [223, 159, 96, 32].flatMap(value => Array(4).fill([value, 0, 0, 255]).flat()));
		for (let i = 0; i < 2; i++) {
			drawGradient(both);
			check(`EffectRenderer lazy MRT ${i}`, await read(single.getOutputTexture('vector')!), Array(16).fill([0, 128, 0, 255]).flat());
			single.setUsedOutputPorts(scalarOnly);
			if (single.getOutputTexture('vector') != null) throw new Error('Unused lazy output was retained');
		}
		single.setResolution({ width: 2, height: 2 });
		drawGradient(both);
		check('EffectRenderer resized output', await read(single.getOutputTexture('scalar')!), [191, 64].flatMap(value => Array(2).fill([value, 0, 0, 255]).flat()));

		// 【モジュール経由の履歴とバイパス・リサイズを実画素で確認する】
		// prepareだけで加算が進まず、バイパス解除では既存履歴から再開し、リサイズでは新しく始める。
		check('module first history frame', await drawModule(), Array(16).fill([64, 0, 0, 64]).flat());
		await renderer.prepare(frame(), new AbortController().signal);
		await renderer.prepare(frame(), new AbortController().signal);
		history.isBypass = true;
		renderer.updateNodes(module.nodes);
		check('module bypasses history', await drawModule(), Array(16).fill([255, 0, 0, 255]).flat());
		history.isBypass = false;
		renderer.updateNodes(module.nodes);
		check('module resumes history', await drawModule(), Array(16).fill([128, 0, 0, 128]).flat());
		renderer.resize({ width: 2, height: 2 });
		check('module resets resized history', await drawModule(), Array(4).fill([64, 0, 0, 64]).flat());
		return completed;
	} finally {
		single.dispose();
		renderer.destroy();
		fallbackTexture.destroy();
	}
}
