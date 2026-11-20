import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import type { EffectInstance } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { checkEffectRenderTiles } from './effect-render-tiles-gpu.ts';
import gradientDefinition from '@gs/subsystems_effect-new_native-effects/fx/gradient/_def_.ts';
import gradient from '@gs/subsystems_effect-new_native-effects/fx/gradient/_impl_.ts';
import feedbackDefinition from '@gs/subsystems_effect-new_native-effects/fx/feedback/_def_.ts';
import feedback from '@gs/subsystems_effect-new_native-effects/fx/feedback/_impl_.ts';
import colorMixDefinition from '@gs/subsystems_effect-new_native-effects/fx/colorMix/_def_.ts';
import colorMix from '@gs/subsystems_effect-new_native-effects/fx/colorMix/_impl_.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { checkEffectTimelineLayers, checkBlurRegionTimelineLayer } from './effect-timeline-layer-gpu.ts';
import { checkTimelineCompositor } from './timeline-compositor-gpu.ts';
import { checkCustomShaderEffects } from './custom-shader-effect-gpu.ts';

export async function runTiledEffects() {
	// 自動分割の実画素比較はtimestamp-queryを要求しないデバイスでも行う。
	return runGpuChecks(checkEffectRenderTiles);
}

export async function runCustomShaderEffects() {
	return runGpuChecks(checkCustomShaderEffects);
}

export async function run() {
	return runGpuChecks(async (device, vertex, read) => {
		const completed = await checkEffectRenderers(device, vertex, read);
		completed.push(...await checkEffectTimelineLayers(device, vertex, read));
		return completed;
	});
}

export async function runTimelineCompositor() {
	return runGpuChecks(async (device, vertex, read) => [
		...await checkTimelineCompositor(device, vertex, read),
		...await checkBlurRegionTimelineLayer(device, vertex, read),
	]);
}

async function runGpuChecks(check: typeof checkTimelineCompositor, enableTiming = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice({ requiredFeatures: enableTiming && adapter.features.has('timestamp-query') ? ['timestamp-query'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	// エフェクトの出力はCOPY_SRCを持たない。画素の検証用にだけRGBA8へコピーする。
	// 同一画素を厳密に比較するため、ここでは補間せずtextureLoadで読み取る。
	const pipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({
				code: `
@group(0) @binding(0) var input: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(input, vec2i(position.xy), 0);
}`,
			}),
			targets: [{ format: 'rgba8unorm' }],
		},
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
			pass.draw(3);
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
		const completed = await check(device, vertex, read);
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
	const gpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	let single: EffectInstance | null = null;
	async function drawGradient(ports: ReadonlySet<string>, resolution: Resolution = { width: 4, height: 4 }) {
		single?.dispose();
		single = await createEffectInstance({ effectSource: { type: 'nativeEffect', id: 'gradient' }, definitions: { getNativeEffect: () => gradientDefinition },
			resolution, usedOutputPorts: ports }, gpu, () => gradient);
		const encoder = device.createCommandEncoder();
		single.render({ time: 1, timeDelta: 250 }, encoder); device.queue.submit([encoder.finish()]);
		return single.outputs;
	}
	const history = { id: 'history', effectSource: { type: 'nativeEffect' as const, id: 'feedback' }, isBypass: false,
		params: { input: { inputSource: 'node' as const, source: { nodeId: 'source', outputPort: 'output' }, sampling: {
			fitMode: 'cover' as const, wrapMode: 'repeatMirrored' as const, filterMode: 'linear' as const } },
			strength: { inputSource: 'literal' as const, value: 1 }, halfLife: { inputSource: 'literal' as const, value: 1e9 } } };
	const graph = { kind: 'generate' as const, paramDefs: {}, primaryInputParameter: null, resolutionInputParameters: [], primaryOutput: 'out', outputDefs: { out: { dataType: { kind: 'color' as const } } },
		nodes: [{ id: 'source', effectSource: { type: 'nativeEffect' as const, id: 'colorMix' }, params: {
			inputA: { inputSource: 'literal' as const, value: [1, 0, 0, 1] }, inputB: { inputSource: 'literal' as const, value: [0, 0, 0, 0] }, amount: { inputSource: 'literal' as const, value: 0 } } }, history],
		outputSources: { out: { nodeId: 'history', outputPort: 'output' } } };
	const createGraph = (size = 4) => createEffectInstance({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph },
		definitions: { getNativeEffect: id => id === 'feedback' ? feedbackDefinition : colorMixDefinition }, usedOutputPorts: new Set(['out']),
		resolution: { width: size, height: size } }, gpu, id => id === 'feedback' ? feedback : colorMix);
	let renderer = await createGraph();
	const frame = () => ({ time: 1, timeDelta: 250 });
	async function drawCustomNodeGraphEffect() {
		const ctx = frame();
		await renderer.prepare(ctx, new AbortController().signal);
		const encoder = device.createCommandEncoder();
		renderer.render(ctx, encoder);
		const output = renderer.outputs.get('out');
		device.queue.submit([encoder.finish()]);
		if (output?.kind !== 'texture') throw new Error('Expected texture from effect');
		return read(output.texture);
	}
	try {
		// 【Native Effectの要求ポートごとの画素を確認する】
		// 要求ポートを変えてGradientを配置し直しても、MRTで値と微分を同時に書き込める。
		const scalarOnly = new Set<'scalar' | 'vector'>(['scalar']);
		const both = new Set<'scalar' | 'vector'>(['scalar', 'vector']);
		let ports = await drawGradient(scalarOnly);
		check('Gradient scalar output', await read((ports.get('scalar') as { texture: GPUTexture }).texture), [223, 159, 96, 32].flatMap(value => Array(4).fill([value, 0, 0, 255]).flat()));
		for (let i = 0; i < 2; i++) {
			ports = await drawGradient(both);
			check(`Gradient MRT ${i}`, await read((ports.get('vector') as { texture: GPUTexture }).texture), Array(16).fill([0, 255, 0, 255]).flat());
			ports = await drawGradient(scalarOnly);
			if (ports.has('vector')) throw new Error('Unused output was allocated');
		}
		ports = await drawGradient(both, { width: 2, height: 2 });
		check('EffectRenderer recreated output', await read((ports.get('scalar') as { texture: GPUTexture }).texture), [191, 64].flatMap(value => Array(2).fill([value, 0, 0, 255]).flat()));

		// 【Custom Node Graph Effect経由の履歴とバイパス・リサイズを実画素で確認する】
		// prepareだけで加算が進まず、バイパス解除・リサイズのどちらでも履歴を新しく始める。
		check('Custom Node Graph Effect first history frame', await drawCustomNodeGraphEffect(), Array(16).fill([64, 0, 0, 64]).flat());
		await renderer.prepare(frame(), new AbortController().signal);
		await renderer.prepare(frame(), new AbortController().signal);
		history.isBypass = true;
		renderer.dispose(); renderer = await createGraph();
		check('Custom Node Graph Effect bypasses history', await drawCustomNodeGraphEffect(), Array(16).fill([255, 0, 0, 255]).flat());
		history.isBypass = false;
		renderer.dispose(); renderer = await createGraph();
		check('Custom Node Graph Effect resets history after bypass', await drawCustomNodeGraphEffect(), Array(16).fill([64, 0, 0, 64]).flat());
		renderer.dispose(); renderer = await createGraph(2);
		check('Custom Node Graph Effect resets resized history', await drawCustomNodeGraphEffect(), Array(4).fill([64, 0, 0, 64]).flat());
		return completed;
	} finally {
		single?.dispose();
		renderer.dispose();
	}
}
