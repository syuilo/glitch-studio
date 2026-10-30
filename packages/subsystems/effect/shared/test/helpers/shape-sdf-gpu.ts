import definition from '../../src/fx/shapeSdf/_def_.ts';
import implementation from '../../src/fx/shapeSdf/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	// r16float/r32floatの出力をどちらも補間・正規化せず読み戻す。
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex, entryPoint: 'vs' },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) f32 { return textureLoad(image, vec2i(p.xy), 0).r; }` }), targets: [{ format: 'r32float' }] },
	});
	const defaults: Parameters = { shape: 'ellipse', position: [0, 0], size: [0.5, 0.5], rotation: 0, cornerRadius: 0 };
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

	function createEffect(width: number, height: number, enable32bitDataTextures: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === (enable32bitDataTextures ? 'r32float' : 'r16float'), 'data texture format');
		const effect = implementation.init({ wgpu, resolution, params: defaults, reportStatus: () => {}, fallbackTexture: output });
		const copyTarget = device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const group = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			effect.render({ params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor), createComputePassEncoder: encoder => encoder.beginComputePass(),
				createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(6); pass.end();
			commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width), y * width);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}

	try {
		// 【形状の値は一様とし、距離場だけを主出力にする】
		// 画素ごとの寸法変更を許すと距離の契約を保てないため、ノード接続を公開しない。
		assert(definition.kind === 'generate' && definition.primaryInputParameter === null && definition.resolutionInputParameters.length === 0, 'generator input contract');
		assert(definition.outputDefs.output.dataType.kind === 'scalar' && definition.primaryOutput === 'output' && !definition.dependsOnRenderHistory, 'scalar output contract');
		assert(Object.values(definition.paramDefs).every(parameter => !('canNode' in parameter) || parameter.canNode !== true), 'uniform shape parameters');
		checks.push('definition contract');
		for (const precise of supports32bit ? [false, true] : [false]) {
			const label = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, message: string) => {
				const tolerance = precise ? 3e-6 + Math.abs(expected) * 2e-6 : 2e-6 + Math.abs(expected) * 0.001;
				assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label} ${message}: ${actual} != ${expected}`);
			};
			const render = createEffect(129, 129, precise);
			const sample = createEffect(1, 1, precise);
			const at = async (point: [number, number], settings: Partial<Parameters>) => (await sample({ ...settings, position: [-point[0] * 2, -point[1] * 2] }))[0];

			// 【円の内外と中心の距離】中心・境界・外側を数値で確認する。
			// 画面中心からの半径が寸法の半分であることも、既知の距離と照合する。
			const circle = await render();
			for (const y of [0, 32, 64, 96, 128]) for (const x of [0, 16, 32, 64, 96, 112, 128]) {
				near(circle[y * 129 + x], Math.hypot((x - 64) / 129, (64 - y) / 129) - 0.25, 'circle distance');
			}
			near(await at([0.25, 0], {}), 0, 'circle boundary');
			checks.push(`${label}: signed circle distances`);

			// 【楕円の実距離】境界の法線に沿って移動した点は、移動量が最短距離になる。
			// 円を引き延ばしただけの擬似距離では長軸・短軸や斜め方向で一致しない。
			for (const [a, b] of [[0.4, 0.1], [0.1, 0.4]]) {
				const settings = { size: [a * 2, b * 2] as [number, number] };
				near(await at([0, 0], settings), -0.1, 'ellipse center');
				near(await at([a + 0.05, 0], settings), 0.05, 'ellipse x axis');
				near(await at([0, b + 0.05], settings), 0.05, 'ellipse y axis');
				// 軸上と軸に極めて近い点は、解の探索区間が異なっても連続な距離を保つ。
				const axisPoint: [number, number] = a > b ? [0.2, 0] : [0, 0.2];
				const axisDistance = await at(axisPoint, settings);
				for (const epsilon of [1e-6, 1e-8, 1e-10]) {
					near(await at(a > b ? [0.2, epsilon] : [epsilon, 0.2], settings), axisDistance, 'ellipse near-axis continuity');
				}
				for (const angle of [0.2, 0.7, 2.1, 4.4]) for (const distance of [-0.01, 0, 0.02]) {
					const nx = Math.cos(angle) / a;
					const ny = Math.sin(angle) / b;
					const length = Math.hypot(nx, ny);
					near(await at([a * Math.cos(angle) + distance * nx / length, b * Math.sin(angle) + distance * ny / length], settings), distance, 'ellipse normal distance');
				}
			}
			near(await at([0, 0], { size: [0.8, 0.00002] }), -0.00001, 'thin ellipse');
			checks.push(`${label}: Euclidean ellipse distances and axes`);

			// 【矩形の辺・角丸・外寸】角丸は外寸を維持し、辺の外側と角の外側で
			// ユークリッド距離を返す。半径の上限・下限も同じ結果になることを確認する。
			const rectangle = { shape: 'rectangle' as const, size: [0.6, 0.3] as [number, number] };
			near(await at([0, 0], rectangle), -0.15, 'rectangle center');
			near(await at([0.4, 0], rectangle), 0.1, 'rectangle side');
			near(await at([0.4, 0.25], rectangle), Math.hypot(0.1, 0.1), 'rectangle corner');
			near(await at([0.3, 0.15], { ...rectangle, cornerRadius: 0.1 }), Math.hypot(0.1, 0.1) - 0.1, 'rounded corner');
			near(await at([0.3, 0], { ...rectangle, cornerRadius: 0.1 }), 0, 'rounded outer width');
			near(await at([0.2, 0.15], { ...rectangle, cornerRadius: 0.1 }), 0, 'rounded outer height');
			near(await at([0.3, 0.15], { ...rectangle, cornerRadius: 10 }), Math.hypot(0.15, 0.15) - 0.15, 'maximum corner radius');
			near(await at([0.3, 0.15], { ...rectangle, cornerRadius: -1 }), 0, 'minimum corner radius');
			checks.push(`${label}: rectangle and clamped corner radius`);

			// 【時計回りの回転と位置】非対称な矩形を45度回し、回転方向を区別する。
			// 1周の周期、画面の上方向、距離1を超える出力も確認する。
			const rotated = { shape: 'rectangle' as const, size: [0.6, 0.2] as [number, number], rotation: 0.125 };
			near(await at([0.2, -0.2], rotated), Math.hypot(0.2, 0.2) - 0.3, 'clockwise long axis');
			near(await at([0.2, 0.2], rotated), Math.hypot(0.2, 0.2) - 0.1, 'clockwise short axis');
			near(await at([0.2, -0.2], { ...rotated, rotation: -0.875 }), Math.hypot(0.2, 0.2) - 0.3, 'negative turn');
			near(await at([0.2, -0.2], { ...rotated, rotation: 1000.125 }), Math.hypot(0.2, 0.2) - 0.3, 'whole turns');
			const shifted = await render({ position: [0, 64 / 129] });
			near(shifted[32 * 129 + 64], -0.25, 'positive y moves upwards');
			near((await sample({ position: [3, 0] }))[0], 1.25, 'offscreen shape and unclamped distance');
			near((await sample({ size: [10, 10] }))[0], -5, 'shape crosses screen boundary');
			checks.push(`${label}: position rotation and offscreen geometry`);

			// 【縦横比・解像度の独立性】縦横比を変えても同じ画面上の長さを保つ。
			// 3倍解像度では同じ画素中心を比較し、解像度依存の距離やAAを検出する。
			const settings = { size: [0.7, 0.3] as [number, number], rotation: 0.125 };
			const small = await createEffect(65, 65, precise)(settings);
			const large = await createEffect(195, 195, precise)(settings);
			const wide = await createEffect(129, 65, precise)(settings);
			const tall = await createEffect(33, 65, precise)(settings);
			for (const y of [0, 16, 32, 48, 64]) for (const x of [16, 24, 32, 40, 48]) {
				const expected = small[y * 65 + x];
				near(large[(y * 3 + 1) * 195 + x * 3 + 1], expected, `resolution-independent distance at ${x},${y}`);
				near(wide[y * 129 + x + 32], expected, 'landscape distance');
				near(tall[y * 33 + x - 16], expected, 'portrait distance');
			}
			checks.push(`${label}: resolution and aspect ratio independence`);

			// 【空形状・パラメータ変更・時刻非依存】寸法が消えてもNaNや古い画素を残さず、
			// 有効な寸法へ戻した描画と別時刻の描画が初回出力に一致することを確認する。
			for (const shape of ['ellipse', 'rectangle'] as const) for (const size of [[0, 0.5], [0.5, 0], [-1, 0.5]] as [number, number][]) {
				assert((await render({ shape, size })).every(value => value === 65504), 'empty shape must use a finite positive distance');
			}
			assert((await render({}, 100)).every((value, index) => value === circle[index]), 'time history or stale parameters affect output');
			checks.push(`${label}: empty shapes and deterministic updates`);
		}
		return { checks };
	} finally {
		for (const dispose of disposables) dispose();
		device.destroy();
	}
}
