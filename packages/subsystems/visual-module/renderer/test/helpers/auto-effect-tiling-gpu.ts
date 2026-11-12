import { VisualModuleRenderer } from '../../src/visual-module-renderer.ts';
import type { VisualModule, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import type { EffectRenderTilingProgress } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import mandelbrotDefinition from '@gs/subsystems_effect_shared/fx/mandelbrot/_def_.ts';
import mandelbrotImplementation from '@gs/subsystems_effect_shared/fx/mandelbrot/_impl_.ts';
import magneticPendulumDefinition from '@gs/subsystems_effect_shared/fx/magneticPendulum/_def_.ts';
import magneticPendulumImplementation from '@gs/subsystems_effect_shared/fx/magneticPendulum/_impl_.ts';
import doublePendulumFractalDefinition from '@gs/subsystems_effect_shared/fx/doublePendulumFractal/_def_.ts';
import doublePendulumFractalImplementation from '@gs/subsystems_effect_shared/fx/doublePendulumFractal/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import TimingHelper from '@gs/shared/gpu/TimingHelper.ts';

type FrameTiming = { label: string; elapsedMs: number; renderMs: number; submissions: number; queries: number; progress: EffectRenderTilingProgress | null };

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null || !adapter.features.has('timestamp-query')) throw new Error('Timestamp-capable WebGPU adapter required');
	const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const checks: string[] = [];
	const timings: FrameTiming[] = [];
	const panBenchmarks: object[] = [];
	const assert = (condition: boolean, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: device.createShaderModule({ code: vertexCode }) }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }),
		targets: [{ format: 'rgba16float' }],
	} });
	let submissions = 0;
	let queries = 0;
	const originalSubmit = device.queue.submit.bind(device.queue);
	device.queue.submit = buffers => { submissions++; originalSubmit(buffers); };
	const originalEncoder = device.createCommandEncoder.bind(device);
	device.createCommandEncoder = descriptor => {
		const encoder = originalEncoder(descriptor);
		const beginRenderPass = encoder.beginRenderPass.bind(encoder);
		encoder.beginRenderPass = passDescriptor => {
			if (passDescriptor.timestampWrites != null) queries++;
			return beginRenderPass(passDescriptor);
		};
		return encoder;
	};
	const literal = <T>(value: T) => ({ inputSource: 'literal' as const, value });
	function createVisualModule(definition: EffectDefinition): VisualModule {
		return {
			paramDefs: [], customParameterDefs: [], customParameterValues: {}, automationGraphs: [], primaryInputId: null,
			primaryOutputId: 'output', outputDefs: [{ id: 'output', dataType: { kind: 'color' } }], nodes: [
				{ id: 'effect', displayName: '', type: 'effect', effectId: definition.id, isBypass: false,
					staticSettings: {}, resolution: { mode: 'context', scale: 1 },
					params: Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, structuredClone(parameter.defaultValue)])) },
				{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'effect', outputPort: 'output' } } },
			],
		};
	}
	function createVisualModuleRenderer(definition: EffectDefinition, implementation: EffectImplementation<any>, visualModule: VisualModule, size: number, mode: 'auto' | 'disabled', statisticsHelper: TimingHelper | null = null) {
		return new VisualModuleRenderer({ gpuDevice: device, fallbackTexture, resolution: { width: size, height: size },
			enableStats: statisticsHelper != null, timingHelper: statisticsHelper, enable32bitDataTextures: false, effectRenderTiling: { mode },
			visualModule, assets: [], assetTextures: new Map(), videoFrameVersions: new Map(),
			effectDefinitions: { [definition.id]: definition }, effectImplementations: { [definition.id]: implementation } });
	}
	async function draw(target: VisualModuleRenderer, label: string, report = true) {
		const start = performance.now();
		const context = { isExport: false, time: 0, timeDelta: 0, endTime: Infinity,
			pointerPosition: { x: 0, y: 0 }, pointerPositionPrev: { x: 0, y: 0 }, evaluatedParamValues: new Map() };
		const signal = new AbortController().signal;
		await target.prepare(context, signal);
		const startSubmissions = submissions;
		const startQueries = queries;
		let progress: EffectRenderTilingProgress | null = null;
		const output = await target.renderTiled(context, signal, value => { if (value != null) progress = value; });
		const renderMs = Math.round((performance.now() - start) * 100) / 100;
		await device.queue.onSubmittedWorkDone();
		if (output?.kind !== 'texture') throw new Error('Expected texture output');
		const timing: FrameTiming = { label, elapsedMs: Math.round(performance.now() - start), renderMs, submissions: submissions - startSubmissions,
			queries: queries - startQueries, progress };
		if (report) {
			timings.push(timing);
			await fetch('/progress', { method: 'POST', body: JSON.stringify(timing) });
		}
		return { texture: output.texture, timing };
	}
	async function pixels(texture: GPUTexture) {
		const { width, height } = texture;
		const copy = device.createTexture({ size: { width, height }, format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 8 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const group = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] });
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copy.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: copy }, { buffer, bytesPerRow }, { width, height });
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const result = new Uint8Array(buffer.getMappedRange().slice(0)); buffer.unmap();
			return result;
		} finally { buffer.destroy(); copy.destroy(); }
	}
	async function compare(auto: VisualModuleRenderer, disabled: VisualModuleRenderer, label: string) {
		const expected = await pixels((await draw(disabled, `${label}: disabled`)).texture);
		const actual = await draw(auto, `${label}: auto`);
		const bytes = await pixels(actual.texture);
		assert(bytes.length === expected.length && bytes.every((value, index) => value === expected[index]), `${label}: exact rgba16float output`);
		const cached = await draw(auto, `${label}: cached`);
		assert(cached.timing.submissions === 0 && cached.timing.queries === 0, `${label}: static cache skips GPU work`);
		return actual;
	}
	try {
		const mandelbrotVisualModule = createVisualModule(mandelbrotDefinition);
		const node = mandelbrotVisualModule.nodes[0] as VisualModuleEffectNode;
		// 過分割が報告された1024角・4235反復の深ズームを回帰条件にする。
		node.params.view = literal({ center: literal([-0.2058423031514639, 0.27240018402412547]), zoom: literal(11601744.655951558), rotation: literal(0) });
		node.params.maximumIterations = literal(4235);
		const auto = createVisualModuleRenderer(mandelbrotDefinition, mandelbrotImplementation, mandelbrotVisualModule, 1024, 'auto');
		const disabled = createVisualModuleRenderer(mandelbrotDefinition, mandelbrotImplementation, mandelbrotVisualModule, 1024, 'disabled');
		try {
			await compare(auto, disabled, 'Mandelbrot initial');
			node.params.view = literal({ center: literal([-0.2058423131514639, 0.27240018402412547]), zoom: literal(11601744.655951558), rotation: literal(0) });
			auto.updateVisualModule(mandelbrotVisualModule, { preserveStaticState: true }); disabled.updateVisualModule(mandelbrotVisualModule, { preserveStaticState: true });
			await compare(auto, disabled, 'Mandelbrot moved');
			// 配色だけならヒントを維持でき、静的キャッシュを更新する実描画もQueryなしへ戻る。
			node.params.unescapedColor = literal([1, 0, 0, 1]);
			auto.updateVisualModule(mandelbrotVisualModule, { preserveStaticState: true });
			const recolored = await draw(auto, 'Mandelbrot recolored');
			assert(recolored.timing.queries === 0, 'Mandelbrot returns to ordinary rendering after a light first draw');
		} finally { auto.destroy(); disabled.destroy(); }

		const pendulum = createVisualModule(magneticPendulumDefinition);
		const pendulumNode = pendulum.nodes[0] as VisualModuleEffectNode;
		const automaticPendulum = createVisualModuleRenderer(magneticPendulumDefinition, magneticPendulumImplementation, pendulum, 1024, 'auto');
		const disabledPendulum = createVisualModuleRenderer(magneticPendulumDefinition, magneticPendulumImplementation, pendulum, 1024, 'disabled');
		try {
			for (const size of [1024, 2048, 1024, 512, 256]) {
				automaticPendulum.resize({ width: size, height: size }); disabledPendulum.resize({ width: size, height: size });
				const actual = await compare(automaticPendulum, disabledPendulum, `Magnetic Pendulum ${size}`);
				if (size <= 512) assert(actual.timing.progress?.totalTiles === 1, `Magnetic Pendulum ${size}: removes unnecessary tiling in the first resized draw`);
			}
			pendulumNode.params.view = literal({ center: literal([0.01, 0]), zoom: literal(1) });
			automaticPendulum.updateVisualModule(pendulum, { preserveStaticState: true }); disabledPendulum.updateVisualModule(pendulum, { preserveStaticState: true });
			const moved = await compare(automaticPendulum, disabledPendulum, 'Magnetic Pendulum moved');
			assert(moved.timing.progress?.totalTiles === 1, 'Magnetic Pendulum removes unnecessary tiling after a view change');
		} finally { automaticPendulum.destroy(); disabledPendulum.destroy(); }
		// ヒントの接続・端数付き積分とAAの変更・配色だけの通常描画復帰を、実際の配置で確かめる。
		const doublePendulumVisualModule = createVisualModule(doublePendulumFractalDefinition);
		const doublePendulumNode = doublePendulumVisualModule.nodes[0] as VisualModuleEffectNode;
		doublePendulumNode.params.coloringMethod = literal('angle1');
		const automaticDoublePendulum = createVisualModuleRenderer(doublePendulumFractalDefinition, doublePendulumFractalImplementation, doublePendulumVisualModule, 256, 'auto');
		const disabledDoublePendulum = createVisualModuleRenderer(doublePendulumFractalDefinition, doublePendulumFractalImplementation, doublePendulumVisualModule, 256, 'disabled');
		try {
			const initial = await compare(automaticDoublePendulum, disabledDoublePendulum, 'Double Pendulum initial');
			assert(initial.timing.progress?.totalTiles === 1, 'Double Pendulum renders a light first draw in one tile');
			doublePendulumNode.params.simulationTime = literal(3.005);
			doublePendulumNode.params.antialiasing = literal(true);
			automaticDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			disabledDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			await compare(automaticDoublePendulum, disabledDoublePendulum, 'Double Pendulum partial step and AA');
			const ramp = doublePendulumFractalDefinition.paramDefs.ramp.defaultValue.value;
			doublePendulumNode.params.ramp = literal({ ...ramp,
				stops: ramp.stops.map((stop, index) => index === 0 ? { ...stop, color: [1, 0, 0, 1] } : stop),
			});
			automaticDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			disabledDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			const recolored = await compare(automaticDoublePendulum, disabledDoublePendulum, 'Double Pendulum recolored');
			assert(recolored.timing.queries === 0, 'Double Pendulum reuses learned untiled rendering for ramp color edits');
			doublePendulumNode.params.view = literal({ center: literal([0.1, 0.2]), zoom: literal(2) });
			automaticDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			disabledDoublePendulum.updateVisualModule(doublePendulumVisualModule, { preserveStaticState: true });
			await compare(automaticDoublePendulum, disabledDoublePendulum, 'Double Pendulum moved');
		} finally { automaticDoublePendulum.destroy(); disabledDoublePendulum.destroy(); }
		// 添付プロジェクトの1024角・約2314積分を64回連続でパンする。256角の単発描画だけでは、
		// 視点キーの再学習や30回ごとの定期計測による引っ掛かりを検出できない。
		for (const statistics of [false, true]) {
			const visualModule = createVisualModule(doublePendulumFractalDefinition);
			const effectNode = visualModule.nodes[0] as VisualModuleEffectNode;
			effectNode.params.initialAngularVelocity1 = literal(4.530000000000001);
			effectNode.params.gravity = literal(26.82);
			effectNode.params.timeStep = literal(0.001296523784419149);
			effectNode.params.angularVelocityRange = literal(8.087466597938915);
			const view = (index: number) => literal({ center: literal([-2.3783367035287313 + index * 0.015, 3.0766039599245305 + index * 0.01]), zoom: literal(1.704604830642477) });
			effectNode.params.view = view(0);
			const automaticStatistics = statistics ? new TimingHelper(device) : null;
			const disabledStatistics = statistics ? new TimingHelper(device) : null;
			const automatic = createVisualModuleRenderer(doublePendulumFractalDefinition, doublePendulumFractalImplementation, visualModule, 1024, 'auto', automaticStatistics);
			const disabled = createVisualModuleRenderer(doublePendulumFractalDefinition, doublePendulumFractalImplementation, visualModule, 1024, 'disabled', disabledStatistics);
			try {
				await compare(automatic, disabled, `Double Pendulum attached statistics=${statistics}`);
				const automaticFrames: FrameTiming[] = [];
				const disabledFrames: FrameTiming[] = [];
				for (let index = 1; index <= 64; index++) {
					effectNode.params.view = view(index);
					automatic.updateVisualModule(visualModule, { preserveStaticState: true });
					disabled.updateVisualModule(visualModule, { preserveStaticState: true });
					disabledFrames.push((await draw(disabled, `pan ${index}: disabled`, false)).timing);
					automaticFrames.push((await draw(automatic, `pan ${index}: auto`, false)).timing);
				}
				const automaticQueries = automaticFrames.reduce((sum, frame) => sum + frame.queries, 0);
				assert(automaticFrames.every(frame => frame.submissions === 1), `panning keeps ordinary submissions with statistics=${statistics}`);
				assert(statistics ? automaticQueries === 64 : automaticQueries > 0 && automaticQueries <= 3,
					`periodic GPU measurements share statistics and avoid per-pan probing with statistics=${statistics}: ${automaticQueries}`);
				const automaticImage = await pixels((await draw(automatic, 'last cached auto', false)).texture);
				const disabledImage = await pixels((await draw(disabled, 'last cached disabled', false)).texture);
				assert(automaticImage.every((value, index) => value === disabledImage[index]), `panning remains pixel-identical with statistics=${statistics}`);
				const median = (values: number[]) => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)];
				panBenchmarks.push({ statistics, frames: 64, automaticQueries,
					disabledMedianMs: median(disabledFrames.map(frame => frame.elapsedMs)), automaticMedianMs: median(automaticFrames.map(frame => frame.elapsedMs)),
					disabledRenderMedianMs: median(disabledFrames.map(frame => frame.renderMs)), automaticRenderMedianMs: median(automaticFrames.map(frame => frame.renderMs)),
				});
				await Promise.all([automatic.lastUntiledGpuTimeResult, disabled.lastUntiledGpuTimeResult]);
			} finally {
				automatic.destroy(); disabled.destroy(); automaticStatistics?.dispose(); disabledStatistics?.dispose();
			}
		}
		assert(errors.length === 0, `no GPU validation errors: ${errors.join('; ')}`);
		return { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description }, checks, timings, panBenchmarks };
	} finally { fallbackTexture.destroy(); device.destroy(); }
}
