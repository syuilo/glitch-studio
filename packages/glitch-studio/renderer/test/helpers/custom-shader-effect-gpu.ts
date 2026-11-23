import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectParameterInput } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { EffectLivePreviewManager } from '@gs/glitch-studio_renderer/effect-live-preview-manager.ts';
import { TimelineRendererManager } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import fillDefinition from '@gs/subsystems_effect_native-effects/fx/fill/_def_.ts';
import fillImplementation from '@gs/subsystems_effect_native-effects/fx/fill/_impl_.ts';
async function checkCanvasPixel(device: GPUDevice, canvas: OffscreenCanvas, expected: number[]) {
	await device.queue.onSubmittedWorkDone();
	const bitmap = await createImageBitmap(canvas);
	try {
		const readback = new OffscreenCanvas(canvas.width, canvas.height).getContext('2d');
		if (readback == null) throw new Error('Readback canvas unavailable');
		readback.drawImage(bitmap, 0, 0);
		const pixel = [...readback.getImageData(0, 0, 1, 1).data];
		if (pixel.join(',') !== expected.join(',')) throw new Error(`Unexpected preview pixel: ${pixel}, expected ${expected}`);
	} finally { bitmap.close(); }
}


const sampling = { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'nearest' } as const;
const resolution = { width: 8, height: 4 };
const shaderSource = { type: 'customShaderEffectReference', id: 'shader' } as const;

function registeredShader(code: string, colorPort = 'color'): ProjectCustomShaderEffect {
	return { id: shaderSource.id, name: 'Shader', summary: '', definition: {
		kind: 'modify', shaderApiVersion: 1, code,
		paramDefs: { source: { nameForReference: 'source', canNode: true, dataType: { kind: 'color' }, ui: { label: 'Source', control: {} }, defaultValue: [1, 0, 1, 1] } },
		primaryInputParameter: 'source', primaryOutput: colorPort, resolutionInputParameters: ['source'],
		outputDefs: { [colorPort]: { nameForReference: 'color', dataType: { kind: 'color' } } },
	} };
}
const copy = 'fn main(p: vec2f) -> Output { return Output(read_source(p)); }';
const green = 'fn main(p: vec2f) -> Output { return Output(vec4f(0, 1, 0, 1)); }';
async function canvasDevice() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const canvas = new OffscreenCanvas(resolution.width, resolution.height);
	return { device, canvas, gpuContext: canvas.getContext('webgpu')! };
}

export async function runCustomShaderEffectLivePreview() {
	const { device, gpuContext } = await canvasDevice();
	const manager = await EffectLivePreviewManager.create({ gpuDevice: device, gpuContext,
		nativeEffectDefinitions: { fill: fillDefinition }, nativeEffectImplementations: { fill: fillImplementation } },
	{ enableStats: false, enableWaveformAndHistogram: false, enable32bitDataTextures: false }, { assets: [], players: [] });
	const errors = Promise.withResolvers<never>();
	manager.on('ev', event => { if (event.type === 'renderError') errors.reject(new Error(event.ctx.message)); });
	function graph(port: string): CustomNodeGraphEffect {
		return { kind: 'generate', primaryInputParameter: null, primaryOutput: 'image', resolutionInputParameters: [], paramDefs: {},
			outputDefs: { image: { dataType: { kind: 'color' } } }, outputSources: { image: { nodeId: 'shader', outputPort: port } },
			nodes: [{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, params: { color: { inputSource: 'literal', value: [1, 0, 1, 1] } } },
				{ id: 'shader', effectSource: shaderSource, params: { source: { inputSource: 'node', source: { nodeId: 'fill', outputPort: 'output' }, sampling } } }] };
	}
	async function pixel(expected: number[]) {
		const capture = await Promise.race([manager.capturePreview(64), errors.promise]);
		if (capture == null) throw new Error('Missing preview capture');
		const bitmap = await createImageBitmap(capture.blob);
		try {
			const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
			ctx.drawImage(bitmap, 0, 0);
			const actual = [...ctx.getImageData(0, 0, 1, 1).data];
			if (actual.join() !== expected.join()) throw new Error('Unexpected captured pixel ' + actual);
		} finally { bitmap.close(); }
	}
	try {
		manager.updateDynamicOptions({ resolution, customShaderEffects: [registeredShader(copy)], customNodeGraphEffects: [{ id: 'graph', name: 'Graph', definition: graph('color') }] });
		manager.startEffectLivePreview({ effectSource: { type: 'customNodeGraphEffectReference', id: 'graph' } });
		await pixel([255, 0, 255, 255]);
		for (const [code, port, expected] of [[green, 'updated', [0, 255, 0, 255]], [copy, 'color', [255, 0, 255, 255]]] as const) {
			manager.applyProjectChanges([{ type: 'customShaderEffectRegistration', customShaderEffectId: 'shader', customShaderEffect: registeredShader(code, port) },
				{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'graph', customNodeGraphEffect: graph(port) }]);
			await pixel([...expected]);
		}
		manager.startEffectLivePreview({ effectSource: shaderSource, params: { source: { inputSource: 'literal', value: [0, 0, 1, 1] } } });
		await pixel([0, 0, 255, 255]);
		manager.updateEffectLivePreviewParamValues({ source: { inputSource: 'literal', value: [1, 0, 0, 1] } });
		await pixel([255, 0, 0, 255]);
		manager.updateEffectLivePreviewParamValues({});
		await pixel([255, 0, 255, 255]);
		const data: CustomShaderEffect = { ...registeredShader(copy).definition, primaryOutput: null, paramDefs: {}, primaryInputParameter: null, resolutionInputParameters: [],
			outputDefs: { red: { nameForReference: 'red', dataType: { kind: 'scalar' } }, vector: { nameForReference: 'vector', dataType: { kind: 'vector' } } },
			code: 'fn main(p: vec2f) -> Output { return Output(1, vec2f(0, 1)); }' };
		const effectSource = { type: 'inlineCustomShaderEffect', customShaderEffect: data } as const;
		manager.startEffectLivePreview({ effectSource });
		await pixel([255, 0, 0, 255]);
		manager.startEffectLivePreview({ effectSource, outputPort: 'vector' });
		await pixel([0, 255, 0, 255]);
		return ['Compiled graph', 'Updated shader and ports', 'Restored shader', 'Standalone shader', 'Edited preview input', 'Reset preview input', 'First declared scalar output', 'Selected vector output'];
	} finally { manager.destroy(); }
}

export async function runCustomShaderEffectTimelineUpdates() {
	const { device, canvas, gpuContext } = await canvasDevice();
	const manager = await TimelineRendererManager.create({ gpuDevice: device, gpuContext, nativeEffectDefinitions: {}, nativeEffectImplementations: {} },
		{ enableWaveformAndHistogram: false, enable32bitDataTextures: false, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 1 } }, { assets: [] });
	try {
		const shader = registeredShader('fn main(p: vec2f) -> Output { return Output(vec4f(1, 0, 1, 1)); }');
		manager.updateDynamicOptions({ resolution, sceneId: 'scene', customShaderEffects: [shader], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{
			id: 'shader', name: 'Shader', layerType: 'effect', effectSource: shaderSource, effectStaticSettings: {}, transformTarget: 'region', isDisabled: false,
			isSolo: false, color: null, forceDisableMotionBlur: false, mask: null, layerMask: null, isIncludedInComposite: true, coordinateSpace: 'screen',
			clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }], resolution: { mode: 'context', scale: 1 }, automationGraphs: [],
			effectParamValues: {}, compositingParamValues: {}, audioParamValues: {},
		}] }] });
		await manager.renderTimelineFrame(0, 0);
		await checkCanvasPixel(device, canvas, [255, 0, 255, 255]);
		manager.applyProjectChanges([{ type: 'customShaderEffectRegistration', customShaderEffectId: shader.id, customShaderEffect: registeredShader(green, 'updated') }]);
		await manager.renderTimelineFrame(0, 0);
		await checkCanvasPixel(device, canvas, [0, 255, 0, 255]);
		return ['Initial shader pixels', 'Updated shader pixels'];
	} finally { manager.destroy(); }
}

export async function checkCustomShaderEffects(device: GPUDevice, vertex: GPUShaderModule, read: (texture: GPUTexture) => Promise<number[]>) {
	const completed: string[] = [];
	const definition: CustomShaderEffect = { ...registeredShader(copy).definition, outputDefs: {
		color: { nameForReference: 'color', dataType: { kind: 'color' } }, mask: { nameForReference: 'mask', dataType: { kind: 'scalar' } },
		vector: { nameForReference: 'vector', dataType: { kind: 'vector' } } },
		code: 'fn main(p: vec2f) -> Output { return Output(read_source(p), 0.25, vec2f(get_pixel_size(), get_resolution().y / 16.0)); }' };
	const inline: EffectSource = { type: 'inlineCustomShaderEffect', customShaderEffect: definition };
	const frame = { time: 1, endTime: Infinity, timeDelta: 0 };
	async function draw(source: EffectSource, ports: string[], inputs: Record<string, EffectParameterInput>, enable32bitDataTextures: boolean) {
		const instance = await createEffectInstance({ effectSource: source, definitions: { getCustomShaderEffect: () => definition,
			getNativeEffect: () => fillDefinition, getCustomNodeGraphEffect: () => { throw new Error('Missing graph'); } },
			resolution, inputs, usedOutputPorts: new Set(ports) }, { device, defaultVertexShaderModule: vertex, enable32bitDataTextures }, () => fillImplementation);
		try {
			await instance.renderTiled(frame);
			return await Promise.all(ports.map(port => {
				const output = instance.outputs.get(port);
				if (output?.kind !== 'texture') throw new Error('Expected texture ' + port);
				return read(output.texture);
			}));
		} finally { instance.dispose(); }
	}
	const check = (name: string, rgba: number[], expected: number[]) => {
		if (expected.some((value, index) => Math.abs(rgba[index] - value) > 2)) throw new Error(name + ': ' + rgba.slice(0, 4));
		completed.push(name);
	};
	const source = { source: constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]) };
	const input = device.createTexture({ size: [2, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	try {
		device.queue.writeTexture({ texture: input }, new Uint8Array([128, 0, 0, 128, 0, 255, 0, 255]), { bytesPerRow: 8 }, [2, 1]);
		for (const precision of [false, true]) {
			const [color, mask, vector] = await draw(inline, ['color', 'mask', 'vector'], source, precision);
			check('Uniform color ' + precision, color, [102, 51, 26, 128]);
			check('Scalar channels ' + precision, mask, [64, 0, 0, 255]);
			check('Vector channels ' + precision, vector, [32, 64, 0, 255]);
			const [pixels] = await draw(inline, ['color'], { source: { kind: 'texture', texture: input, resolution: { width: 2, height: 1 }, sampling } }, precision);
			check('Texture left ' + precision, pixels, [128, 0, 0, 128]);
			check('Texture right ' + precision, pixels.slice(-4), [0, 255, 0, 255]);
		}
		const coordinates = { ...definition, code: 'fn main(p: vec2f) -> Output { var o: Output; o.color = vec4f(p + vec2f(0.5, 0.25), get_pixel_size(), 1); return o; }' };
		const [pixels, unused] = await draw({ type: 'inlineCustomShaderEffect', customShaderEffect: coordinates }, ['color', 'vector'], source, false);
		check('Top left', pixels, [16, 112, 32, 255]);
		check('Bottom right', pixels.slice(-4), [239, 16, 32, 255]);
		check('Unassigned vector', unused, [0, 0, 0, 255]);
		try {
			await draw({ type: 'inlineCustomShaderEffect', customShaderEffect: { ...definition, code: 'fn main(p: vec2f) -> Output {\nreturn unknown_name; }' } }, ['color'], source, false);
			throw new Error('Expected compilation error');
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('2:')) throw error;
			completed.push('User-code line diagnostic');
		}
	} finally { input.destroy(); }
	return completed;
}
