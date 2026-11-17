import definition from '../../src/fx/shatterTransition/_def_.ts';
import implementation from '../../src/fx/shatterTransition/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run(includePreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
	disposables.push(() => fallbackTexture.destroy());
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.003) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
		progress: scalar(0.4), fragmentSize: 0.08, irregularity: 0.8, center: [0, 0],
		spread: 0.6, depth: 0.5, rotation: 0.75, gravity: 0.25, stagger: 0.3,
		perspective: 0.5, shading: 0.6, seed: 0, sizeReference: 'longSide',
	};
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});

	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally { target.destroy(); buffer.destroy(); }
	}

	function textureInput(width: number, height: number, values: number[], scalarTexture = false, filterMode: 'linear' | 'nearest' = 'linear') {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode, fitMode: 'stretch', wrapMode: 'clamp' });
	}

	function createEffect(width: number, height: number, enable32bitDataTextures = false) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const coverageOutput = implementation.outputTextureFactories.coverage({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); output.destroy(); coverageOutput.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0, mode: 'both' | 'color' | 'coverage' = 'both') => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: {
					...(mode === 'coverage' ? {} : { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } }),
					...(mode === 'color' ? {} : { coverage: { texture: coverageOutput, textureView: coverageOutput.createView(), previousFrameTexture: null, previousFrameTextureView: null } }),
				},
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			device.queue.submit([encoder.finish()]);
			const pixels = mode === 'coverage' ? new Float32Array() : await read(output);
			const coverage = mode === 'color' ? new Float32Array() : await read(coverageOutput);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite output');
			return { pixels, coverage };
		};
	}

	const pixelAt = (pixels: Float32Array, width: number, x: number, y: number) => pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
	const colorNear = (pixel: Float32Array, expected: readonly number[], label: string, tolerance = 0.003) => expected.forEach((value, channel) => near(pixel[channel], value, label, tolerance));
	const coordinateTexture = (width: number, height: number) => textureInput(width, height,
		Array.from({ length: width * height }, (_, index) => [(index % width + 0.5) / width, 1 - (Math.floor(index / width) + 0.5) / height, 0.25, 1]).flat());
	type Vector3 = [number, number, number];
	const dot = (a: Vector3, b: Vector3) => a.reduce((sum, value, index) => sum + value * b[index], 0);
	const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const hash = (value: number) => {
		value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
		value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
		return (value ^ (value >>> 16)) >>> 0;
	};
	// GPUと同じ乱数から運動条件だけを取り出す。期待画素は投影三角形の再描画ではなく、
	// quaternionの逆回転と、画素から飛ばしたレイ/平面の交差で独立に計算する。
	const referenceShards = (seed: number, progress: number, depth: number) => [0, 1].map(index => {
		const random = (salt: number) => hash(index ^ hash(seed + salt)) / 2 ** 32;
		const center: Vector3 = index === 0 ? [1 / 6, -1 / 6, 0] : [-1 / 6, 1 / 6, 0];
		const axisZ = random(83) * 2 - 1;
		const axisAngle = random(97) * Math.PI * 2;
		const angle = 1.1 * Math.PI * 2 * progress * (0.5 + random(101)) * (random(103) >= 0.5 ? 1 : -1);
		const axis: Vector3 = [Math.cos(axisAngle) * Math.sqrt(1 - axisZ ** 2), Math.sin(axisAngle) * Math.sqrt(1 - axisZ ** 2), axisZ];
		const rotation = (vector: Vector3, inverse = false): Vector3 => {
			const sine = Math.sin(angle / 2) * (inverse ? -1 : 1);
			const quaternion: Vector3 = axis.map(value => value * sine) as Vector3;
			const first = cross(quaternion, vector);
			const second = cross(quaternion, first);
			return vector.map((value, component) => value + 2 * (Math.cos(angle / 2) * first[component] + second[component])) as Vector3;
		};
		const position: Vector3 = [center[0], center[1] - 0.1 * progress ** 2, -depth * progress * (0.7 + 0.6 * random(79))];
		return { index, center, position, rotation, normal: rotation([0, 0, 1]) };
	});

	try {
		// 【一様な進捗の端点は透明度やHDRを含めて元画像と一致する】
		// 分割や被覆合成によって、半透明画像にBを二重合成する誤りを検出する。
		const render = createEffect(65, 33);
		for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
			const result = await render({ progress: scalar(progress) });
			result.pixels.forEach((value, index) => near(value, (progress < 0.5 ? colorA : colorB)[index % 4], 'continuous endpoint', 0.004));
			for (let index = 0; index < result.coverage.length; index += 4) near(result.coverage[index], progress < 0.5 ? 1 : 0, 'endpoint coverage', 0.004);
		}
		checks.push('continuous HDR endpoints');

		// 【分割しただけでは画像に亀裂や色の継ぎ目が生じない】
		// 大小の格子、規則/不規則な形、縦横比を変え、全画素の被覆と座標画像を照合する。
		for (const [width, height] of [[65, 33], [33, 65], [1, 17], [17, 1]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			const original = await sample({ inputA, progress: scalar(0) });
			for (const fragmentSize of [0.04, 0.3, 1]) {
				for (const irregularity of [0, 1]) {
					const split = await sample({ inputA, fragmentSize, irregularity, seed: 713, progress: scalar(0.5), spread: 0, depth: 0, rotation: 0, gravity: 0, shading: 0 });
					equal(split.pixels, original.pixels, 'gapless tessellation');
					for (let index = 0; index < split.coverage.length; index += 4) near(split.coverage[index], 1, 'full geometric coverage', 0);
				}
			}
		}
		checks.push('gapless tessellation across shapes and aspect ratios');

		// 【飛散と終盤のフェードは色のalphaとは独立した幾何的な置換】
		// 全破片を同じ色にすると、出力はA*Coverage+B*(1-Coverage)になる。
		// 特に透明なAの下へBをsource-overしてしまう誤りと、Coverageの二重乗算を検出する。
		for (const progress of [0.2, 0.6, 0.9, 0.99]) {
			const result = await render({ progress: scalar(progress), rotation: 0, shading: 0 });
			for (let index = 0; index < result.pixels.length; index += 4) {
				const amount = result.coverage[index];
				colorNear(result.pixels.subarray(index, index + 4), colorA.map((value, channel) => value * amount + colorB[channel] * (1 - amount)), 'geometric replacement');
			}
			const invisible = await render({ inputA: constantShaderInput('color', [8, -3, 2, 0]), progress: scalar(progress), rotation: 0 });
			equal(invisible.coverage, result.coverage, 'alpha independent coverage');
			for (let index = 0; index < invisible.pixels.length; index += 4) colorNear(invisible.pixels.subarray(index, index + 4), colorB.map(value => value * (1 - result.coverage[index])), 'transparent shards replace background');
		}
		checks.push('geometric compositing HDR and transparent shards');

		// 【移動を無効にしても終端へ滑らかにつながる】
		// 破片が画面に残る設定で、最後のフレームだけBに置換する実装を防ぐ。
		for (const stagger of [0, 1]) {
			let previous = 1;
			for (const progress of [0.8, 0.9, 0.95, 0.99, 0.9999, 1]) {
				const result = await render({ progress: scalar(progress), stagger, spread: 0, depth: 0, rotation: 0, gravity: 0, shading: 0 });
				const mean = result.coverage.filter((_, index) => index % 4 === 0).reduce((sum, value) => sum + value, 0) / (65 * 33);
				assert(mean <= previous + 0.00001, 'remaining coverage decreases');
				previous = mean;
				if (progress >= 0.9999) result.pixels.forEach((value, index) => near(value, colorB[index % 4], 'fade approaches B'));
			}
		}
		checks.push('continuous fade with stationary shards');

		// 【透視投影・回転・裏面・前後関係をレイの交差から検証する】
		// 2枚だけの既知の三角形に分け、重なった場所では奥行きの近い面の材料色を期待する。
		// 奥行きソートをしない描画、回転でUVを貼り直す誤り、裏面カリングを検出する。
		const square = createEffect(129, 129);
		const pattern = coordinateTexture(129, 129);
		let overlapChecks = 0;
		let frontChecks = 0;
		let backChecks = 0;
		for (const seed of [0, 1, 3]) {
			for (const depth of [-0.3, 0.4]) {
				const progress = 0.37;
				const result = await square({ inputA: pattern, fragmentSize: 1, irregularity: 0, seed, progress: scalar(progress), spread: 0, depth, rotation: 1.1, gravity: 0.1, stagger: 0, perspective: 0.8, shading: 1 });
				const shards = referenceShards(seed, progress, depth);
				for (let y = 4; y < 125; y += 5) {
					for (let x = 4; x < 125; x += 5) {
						const origin: Vector3 = [(x + 0.5) / 129 - 0.5, 0.5 - (y + 0.5) / 129, 0];
						const direction: Vector3 = [-0.8 * origin[0], -0.8 * origin[1], 1];
						const hits = shards.map(shard => {
							const denominator = dot(shard.normal, direction);
							const distance = dot(shard.normal, shard.position.map((value, channel) => value - origin[channel]) as Vector3) / denominator;
							const intersection = origin.map((value, channel) => value + distance * direction[channel]) as Vector3;
							const local = shard.rotation(intersection.map((value, channel) => value - shard.position[channel]) as Vector3, true);
							const u = local[0] + shard.center[0];
							const v = local[1] + shard.center[1];
							const margin = Math.min(0.5 - Math.abs(u), 0.5 - Math.abs(v), shard.index === 0 ? u - v : v - u);
							return { shard, distance, u, v, margin, front: denominator > 0 };
						});
						// MSAAの輪郭画素やテクスチャの端の縮小補間は、別の被覆テストで扱う。
						if (hits.some(hit => !Number.isFinite(hit.margin) || Math.abs(hit.margin) < 0.04)) continue;
						const visible = hits.filter(hit => hit.margin > 0).sort((a, b) => b.distance - a.distance);
						if (visible.length === 0) {
							colorNear(pixelAt(result.pixels, 129, x, y), colorB, 'ray misses all shards');
							continue;
						}
						const hit = visible[0];
						if (Math.max(Math.abs(hit.u), Math.abs(hit.v)) > 0.35) continue;
						const light = (0.55 + 0.45 * Math.abs(hit.shard.normal[2])) * (hit.front ? 1 : 0.65);
						colorNear(pixelAt(result.pixels, 129, x, y), [(hit.u + 0.5) * light, (hit.v + 0.5) * light, 0.25 * light, 1], 'ray material and lighting', 0.012);
						if (visible.length > 1) overlapChecks++;
						if (hit.front) frontChecks++; else backChecks++;
					}
				}
			}
		}
		assert(overlapChecks > 5 && frontChecks > 5 && backChecks > 5, `ray probes include overlaps and both faces: ${overlapChecks}/${frontChecks}/${backChecks}`);
		checks.push('independent ray reference for 3D materials backs and occlusion');

		// 【重心ごとのProgressが同じ破片全体を動かす】
		// 1セルの2三角形は重心のX符号が異なる。左は開始前、右は終了後にし、
		// 単なる画素ごとのA/B切り替えでは得られない対角線の被覆を確認する。
		const localProgress = textureInput(2, 1, [0, 1], true, 'nearest');
		const local = await square({ progress: localProgress, fragmentSize: 1, irregularity: 0, spread: 0, depth: 0, rotation: 0, gravity: 0, shading: 0 });
		colorNear(pixelAt(local.pixels, 129, 96, 16), colorA, 'top triangle stays intact across right half');
		colorNear(pixelAt(local.pixels, 129, 48, 112), colorB, 'bottom triangle disappears across left half');
		const allZero = await square({ progress: textureInput(1, 1, [0], true), inputA: pattern });
		equal(allZero.pixels, (await square({ inputA: pattern, progress: scalar(0) })).pixels, 'textured zero progress covers whole image');
		checks.push('local progress at original shard centroids');

		// 【定数とテクスチャの全入力構成、接続設定、動画相当の更新を扱う】
		// Aだけを一度保存する実装や、Bの座標を破片と一緒に動かす実装を検出する。
		const textureA = textureInput(3, 5, Array.from({ length: 15 }, () => colorA).flat());
		const textureB = textureInput(5, 3, Array.from({ length: 15 }, () => colorB).flat());
		const baseline = await render({ stagger: 0, progress: scalar(0.375) });
		for (let bits = 0; bits < 8; bits++) {
			const result = await render({ inputA: (bits & 1) !== 0 ? textureA : defaults.inputA, inputB: (bits & 2) !== 0 ? textureB : defaults.inputB, progress: (bits & 4) !== 0 ? textureInput(1, 1, [0.375], true) : scalar(0.375), stagger: 0 });
			equal(result.pixels, baseline.pixels, 'uniform and texture combinations');
			equal(result.coverage, baseline.coverage, 'progress input combinations');
		}
		const textureRender = createEffect(65, 33);
		const patternA = coordinateTexture(65, 33);
		const patternB = coordinateTexture(33, 65);
		for (const endpoint of [0, 1]) {
			const exact = await textureRender({ inputA: patternA, inputB: patternB, progress: scalar(endpoint) });
			const close = await textureRender({ inputA: patternA, inputB: patternB, progress: scalar(endpoint === 0 ? 0.000001 : 0.999999) });
			equal(close.pixels, exact.pixels, 'textured continuous endpoints');
		}
		assert(textureA.kind === 'texture', 'texture kind');
		if (textureA.kind === 'texture') {
			const contained = { ...textureA, fitMode: 'contain' as const, wrapMode: 'transparent' as const, filterMode: 'nearest' as const };
			const parameters = { inputA: contained, inputB: patternB, spread: 0, depth: 0, rotation: 0, gravity: 0, shading: 0 };
			const assembled = await textureRender(parameters);
			equal(assembled.pixels, (await textureRender({ ...parameters, progress: scalar(0) })).pixels, 'material honors contain transparent and nearest');
		}
		const before = await textureRender({ inputA: patternA });
		const after = await textureRender({ inputA: patternB });
		assert(after.pixels.some((value, index) => Math.abs(value - before.pixels[index]) > 0.0001), 'material uses current input texture');
		equal((await textureRender({ inputA: patternA })).pixels, before.pixels, 'restoring current material');
		checks.push('all input combinations sampling settings and current textures');

		// 【陰影は破片の色だけを変え、被覆やalphaを変えない】
		// 裏面を含む回転状態で、HDR/負値を保ちつつ形状の一致を確認する。
		const unlit = await render({ shading: 0 });
		const lit = await render({ shading: 1 });
		equal(lit.coverage, unlit.coverage, 'shading preserves geometry');
		for (let index = 3; index < lit.pixels.length; index += 4) near(lit.pixels[index], unlit.pixels[index], 'shading preserves alpha', 0);
		assert(lit.pixels.some((value, index) => index % 4 === 0 && value > 1), 'HDR survives lighting');
		assert(lit.pixels.some((value, index) => index % 4 === 1 && value < 0), 'negative RGB survives lighting');
		checks.push('lighting preserves signed HDR alpha and coverage');

		// 【片方だけ使う出力と32bit Coverageでも同じ結果】
		// 未確保の画像出力を参照せず、Coverage単独ならA/Bを読まずに描画できる必要がある。
		const both = await render();
		equal((await render({}, 0, 'color')).pixels, both.pixels, 'color only');
		equal((await render({}, 0, 'coverage')).coverage, both.coverage, 'coverage only');
		const floatCoverage = await createEffect(65, 33, true)();
		equal(floatCoverage.pixels, both.pixels, '32bit setting does not change image');
		equal(floatCoverage.coverage, both.coverage, '32bit coverage agrees');
		const destroyedTexture = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
		destroyedTexture.destroy();
		const unusedImage = textureShaderInput(destroyedTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' });
		equal((await render({ inputA: unusedImage, inputB: unusedImage }, 0, 'coverage')).coverage, both.coverage, 'coverage does not bind unused images');
		checks.push('lazy output combinations and 32bit coverage');

		// 【位置は共通単位を保ち、寸法だけSize Referenceで換算する】
		// 同じシーンの解像度変更と時刻・再生順序に依存しないことを確認する。
		const reference = await render({ fragmentSize: 0.08 * 33 / 65, spread: 0.6 * 33 / 65, depth: 0.5 * 33 / 65, gravity: 0.25 * 33 / 65, center: [0.1, -0.05] });
		const sized = await render({ sizeReference: 'height', center: [0.1, -0.05] });
		equal(reference.pixels, sized.pixels, 'size reference image');
		equal(reference.coverage, sized.coverage, 'size reference coverage');
		await render({ seed: 91, fragmentSize: 0.2, progress: scalar(0.8) }, 8);
		equal((await render({}, -3)).pixels, both.pixels, 'scrub and mesh changes are deterministic');
		assert((await render({ seed: 7 })).coverage.some((value, index) => Math.abs(value - both.coverage[index]) > 0.05), 'seed changes breakup');
		const low = await render({ spread: 0, depth: 0, rotation: 0, shading: 0, stagger: 0, gravity: 0.25 });
		const high = await createEffect(195, 99)({ spread: 0, depth: 0, rotation: 0, shading: 0, stagger: 0, gravity: 0.25 });
		for (const [x, y] of [[10, 8], [32, 16], [40, 28]]) colorNear(pixelAt(high.pixels, 195, x * 3 + 1, y * 3 + 1), pixelAt(low.pixels, 65, x, y), 'resolution invariant geometry');
		checks.push('size reference resolution seed and history');

		// 【手前への飛散でカメラ面を跨いでも有限の描画になる】
		// 巨大な投影座標をCPUで除算せず、GPUの同次座標クリップに任せる。
		for (const depth of [-4, 4]) for (const progress of [0.1, 0.4, 0.8, 0.99]) {
			const result = await render({ depth, perspective: 1, progress: scalar(progress), center: [0.2, -0.1] });
			for (let index = 0; index < result.coverage.length; index += 4) assert(result.coverage[index] >= 0 && result.coverage[index] <= 1, 'bounded coverage when clipped');
		}
		checks.push('camera clipping and extreme depths');

		let preview: string | null = null;
		if (includePreview) {
			// 実GPUの色とCoverageを並べて手動QAする。文字で破片の材料座標も確認できる。
			const width = 240;
			const height = 160;
			const makeCard = (second: boolean) => {
				const canvas = new OffscreenCanvas(width, height);
				const context = canvas.getContext('2d')!;
				context.fillStyle = second ? '#143d66' : '#f7ead1'; context.fillRect(0, 0, width, height);
				context.fillStyle = second ? '#54dbca' : '#bc4134'; context.fillRect(12, 12, width - 24, 34);
				context.font = 'bold 22px sans-serif'; context.fillStyle = second ? '#143d66' : '#fff8e9';
				context.fillText(second ? 'IMAGE B' : 'IMAGE A', 24, 37);
				context.font = '18px sans-serif'; context.fillStyle = second ? '#ccf2ef' : '#403b31';
				context.fillText('1   2   3   4   5', 25, 82); context.fillText('6   7   8   9   0', 25, 112);
				context.fillRect(24, 132, 135, 3);
				const pixels = context.getImageData(0, 0, width, height).data;
				const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
				return textureInput(width, height, Array.from(pixels, (value, index) => index % 4 === 3 ? value / 255 : linear(value / 255)));
			};
			const inputA = makeCard(false);
			const inputB = makeCard(true);
			const sample = createEffect(width, height);
			const canvas = new OffscreenCanvas(width * 5, (height + 28) * 4);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#24272c'; context.fillRect(0, 0, canvas.width, canvas.height);
			const srgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
			for (let row = 0; row < 4; row++) {
				for (const [column, progress] of [0, 0.2, 0.4, 0.7, 1].entries()) {
					const result = await sample({ inputA, inputB, fragmentSize: 0.12, seed: 3, progress: scalar(progress), ...(row === 1 ? { depth: -0.4, gravity: 0 } : {}), ...(row === 2 ? { spread: 0.1, depth: 0.2, gravity: 0.7, stagger: 0.8 } : {}) });
					const encoded = Uint8ClampedArray.from(row === 3 ? result.coverage : result.pixels, (value, index) => {
						if (row === 3) return index % 4 === 3 ? 255 : Math.round(result.coverage[index - index % 4] * 255);
						return 255 * (index % 4 === 3 ? value : srgb(Math.max(0, value)));
					});
					context.putImageData(new ImageData(encoded, width, height), column * width, row * (height + 28) + 28);
					context.fillStyle = '#ffffff'; context.font = '13px sans-serif';
					context.fillText(`${['outward', 'toward camera', 'falling', 'coverage'][row]} / ${progress}`, column * width + 8, row * (height + 28) + 19);
				}
			}
			const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
			preview = btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
		}
		return { checks, preview };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
