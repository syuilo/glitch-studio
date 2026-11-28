import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/pointNetwork3d/_def_.ts';
import implementationNative from '../../src/fx/pointNetwork3d/_impl_.ts';
import commonCode, { uniforms, structs } from '../../src/fx/pointNetwork3d/common.shader.ts?shader';
import connectCode from '../../src/fx/pointNetwork3d/connect.wgsl?raw';
import { MAX_POINT_COUNT, MAX_NEIGHBOR_COUNT } from '../../src/fx/pointNetwork3d/constants.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { linearSrgbToSrgb } from '@gs/shared/color-space.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;
type Vector3 = [number, number, number];

export async function run(includePreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.004) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		// MSAAで加算したrgba16floatの画像にはGPUの丸め差を許す。
		// 接続候補の整数IDは別の検査で完全一致させ、接続の揺れをこの許容値で隠さない。
		const differences = actual.reduce((count, value, index) => count + Number(Math.abs(value - expected[index]) > 0.001 * Math.max(1, Math.abs(expected[index]))), 0);
		const maximum = actual.reduce((difference, value, index) => Math.max(difference, Math.abs(value - expected[index])), 0);
		assert(actual.length === expected.length && differences === 0, `${label}: ${differences} differing channels, maximum ${maximum}`);
	};
	const different = (actual: Float32Array, expected: Float32Array, label: string) => assert(actual.some((value, index) => Math.abs(value - expected[index]) > 0.01), label);
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.defaultValue])) as unknown as Parameters;
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	async function checkValidation() {
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
	}

	function createEffect(width = 129, height = 129) {
		const resolution = { width, height };
		const output = implementation.createTexture('output', { wgpu, resolution });
		assert(output.format === 'rgba16float', 'HDR image format');
		const instance = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readerGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, contextTime = 0) => {
			const encoder = device.createCommandEncoder();
			await instance.draw({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time: contextTime, timeDelta: 1000 / 17,
				pointerPosition: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readerGroup); pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			// コンパイル失敗時にmapAsyncの二次エラーだけを出さず、元のWGSLエラーを報告する。
			await checkValidation();
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			assert(pixels.every(Number.isFinite), 'finite image');
			assert(pixels.every((value, index) => index % 4 !== 3 || (value >= 0 && value <= 1)), 'bounded alpha');
			return pixels;
		};
	}

	const center = (pixels: Float32Array, width: number, height = width) => pixels.subarray((Math.floor(height / 2) * width + Math.floor(width / 2)) * 4, (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 4);
	const coverage = (pixels: Float32Array) => pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0);
	const empty = (pixels: Float32Array, label: string) => assert(pixels.every(value => value === 0), label);
	const bounds = (pixels: Float32Array, width: number) => {
		let left = width; let right = -1; let top = pixels.length / 4 / width; let bottom = -1;
		for (let index = 3; index < pixels.length; index += 4) {
			if (pixels[index] < 0.5) continue;
			const pixel = (index - 3) / 4; const x = pixel % width; const y = Math.floor(pixel / width);
			left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
		}
		return { width: right - left + 1, height: bottom - top + 1 };
	};

	// 任意の既知の点配置を直接与え、実際の接続シェーダーを検査する。
	// 期待値は全距離のソートで求め、GPUの挿入法や近傍バッファの内容を流用しない。
	async function readNeighbors(base: Vector3[], positions: Vector3[], maximumConnections: number, radius: number, fixed: boolean) {
		const values = createShaderBuffer(uniforms.uniforms);
		values.set({ pointCount: base.length, maximumConnections, connectionDistance: radius, fixedConnections: Number(fixed) });
		const uniformBuffer = device.createBuffer({ size: values.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(uniformBuffer, 0, values.arrayBuffer);
		const points = device.createBuffer({ size: base.length * structs.PointState.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		for (let index = 0; index < base.length; index++) {
			const point = createShaderBuffer(structs.PointState);
			point.set({ base: [...base[index], 1], position: [...positions[index], 1] });
			device.queue.writeBuffer(points, index * structs.PointState.byteLength, point.arrayBuffer);
		}
		const size = base.length * structs.Neighbors.byteLength;
		const neighbors = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
		const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: commonCode + '\n' + connectCode }), entryPoint: 'connect' } });
			const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: points } }, { binding: 2, resource: { buffer: neighbors } }] });
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(base.length / 64)); pass.end();
			encoder.copyBufferToBuffer(neighbors, 0, readback, 0, size); device.queue.submit([encoder.finish()]);
			await checkValidation(); await readback.mapAsync(GPUMapMode.READ);
			assert(structs.Neighbors.view.kind === 'struct', 'neighbor layout');
			if (structs.Neighbors.view.kind !== 'struct') throw new Error('neighbor layout');
			const indicesLayout = structs.Neighbors.view.fields.indices;
			if (indicesLayout.kind !== 'typedArray') throw new Error('neighbor indices layout');
			const mapped = readback.getMappedRange();
			const lists = base.map((_, index) => Array.from(new Uint32Array(mapped, index * structs.Neighbors.byteLength + indicesLayout.offset, MAX_NEIGHBOR_COUNT)));
			readback.unmap();
			return lists;
		} finally { uniformBuffer.destroy(); points.destroy(); neighbors.destroy(); readback.destroy(); }
	}

	try {
		const render = createEffect();
		const baseline = await render();
		// 【初期値で点・線・面が描かれ、非表示にすると以前の画面を残さない】
		// 個々の表示切替と空集合の出力を確認し、隠した線への面描画の依存も検出する。
		assert(coverage(baseline) > 10, 'visible defaults');
		for (const visible of ['showPoints', 'showLines', 'showFaces'] as const) {
			assert(coverage(await render({ showPoints: false, showLines: false, showFaces: false, [visible]: true })) > 0, `independent ${visible}`);
		}
		empty(await render({ showPoints: false, showLines: false, showFaces: false }), 'all hidden clears output');
		empty(await render({ pointCount: 0 }), 'zero points clears output');
		empty(await render({ showPoints: false, maximumConnections: 0 }), 'no connections');
		empty(await render({ showPoints: false, connectionDistance: 0 }), 'zero radius');
		checks.push('independent visibility and empty outputs');

		// 【絶対時刻とSeedだけで点の動きが決まり、シークや描画間隔に依存しない】
		// FPS依存の積分と、毎フレームの再抽選によるちらつきを防ぐ。
		const animated = await render({ time: 5 });
		different(animated, baseline, 'time animates network');
		await render({ time: -10, pointCount: 16, seed: 7 });
		equal(await render({}, 500), baseline, 'context time and render order independent');
		equal(await render({ time: 5 }), animated, 'seek restores network');
		equal(await render({ time: 100, motionSpeed: 0 }), baseline, 'zero speed');
		equal(await render({ time: 100, motionAmount: 0 }), await render({ motionAmount: 0 }), 'zero motion');
		different(await render({ seed: 16777216 }), await render({ seed: 16777217 }), 'distinct integer seeds');
		checks.push('deterministic motion and seeds');

		// 【近傍は半径内の近い順で選び、同距離でも選択が一定になる】
		// 固定/動的の位置、ゼロ距離、上限0/1/最大を含め、各点の候補列を独立した期待値と照合する。
		const base: Vector3[] = [[0, 0, 0], [0.25, 0, 0], [-0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.25], [0, 0, 0], [1, 1, 1]];
		const moved = base.map((point, index) => [point[0] + index * 0.125, point[1], point[2]] as Vector3);
		for (const fixed of [false, true]) {
			for (const maximumConnections of [0, 1, 3, MAX_NEIGHBOR_COUNT]) {
				for (const radius of [0, 0.25, 0.75]) {
					const lists = await readNeighbors(base, moved, maximumConnections, radius, fixed);
					const reference = fixed ? base : moved;
					for (let index = 0; index < base.length; index++) {
						const expected = reference.map((position, other) => ({ other, distance: position.reduce((sum, value, axis) => sum + (value - reference[index][axis]) ** 2, 0) }))
							.filter(candidate => candidate.other !== index && candidate.distance < radius ** 2)
							.sort((a, b) => a.distance - b.distance || a.other - b.other).slice(0, maximumConnections).map(candidate => candidate.other);
						const actual = lists[index].filter(other => other < base.length);
						assert(JSON.stringify(actual) === JSON.stringify(expected), `nearest candidates ${index}, radius ${radius}, count ${maximumConnections}`);
						const mutual = actual.filter(other => lists[other].includes(index));
						assert(mutual.length <= maximumConnections && new Set(mutual).size === mutual.length && !mutual.includes(index), 'bounded distinct mutual neighbors');
					}
				}
			}
		}
		assert(JSON.stringify(await readNeighbors(base, moved, 3, 0.75, false)) !== JSON.stringify(await readNeighbors(base, moved, 3, 0.75, true)), 'motion changes dynamic connectivity');
		checks.push('reference proximity graph and fixed connections');

		// 【点の画面基準は距離によらず、空間基準は遠近と平行投影倍率に従う】
		// 既知の単一点の被覆面積を比較し、サイズ空間が位置へ混入する誤りを防ぐ。
		const single: Partial<Parameters> = { distribution: 'grid', pointCount: 1, motionAmount: 0, showLines: false, showFaces: false, pointSize: 0.16, pointColor: [1, 1, 1, 1], nearFade: 0 };
		const screen = await render(single);
		equal(await render({ ...single, cameraZ: defaults.cameraZ * 2 }), screen, 'screen size ignores distance');
		const world = await render({ ...single, sizeSpace: 'world' });
		near(coverage(await render({ ...single, sizeSpace: 'world', cameraZ: defaults.cameraZ * 2 })) / coverage(world), 0.25, 'perspective world area', 0.04);
		equal(await render({ ...single, projection: 'orthographic', orthographicSize: 2 }), await render({ ...single, projection: 'orthographic' }), 'orthographic screen size');
		near(coverage(await render({ ...single, sizeSpace: 'world', projection: 'orthographic', orthographicSize: 2 })) / coverage(await render({ ...single, sizeSpace: 'world', projection: 'orthographic' })), 0.25, 'orthographic world area', 0.04);
		checks.push('point screen and world dimensions');

		// 【線の太さも点と同じ基準を使い、各辺を一度だけ描く】
		// 既知の2点を1本だけ結び、線幅と色・alphaを解析値で確認する。
		const line: Partial<Parameters> = { distribution: 'grid', pointCount: 2, extent: [0.6, 0], extentZ: 0, motionAmount: 0, showPoints: false, showFaces: false,
			maximumConnections: 1, connectionDistance: 1, connectionFade: 0, lineWidth: 0.04, lineColor: [2, -1, 0.5, 0.5], nearFade: 0 };
		const linePixels = await render(line);
		center(linePixels, 129).forEach((value, channel) => near(value, [1, -0.5, 0.25, 0.5][channel], 'single premultiplied HDR edge'));
		const thickLine = { ...line, lineColor: [1, 1, 1, 1] as [number, number, number, number], lineWidth: 0.08 };
		const screenBounds = bounds(await render(thickLine), 129);
		near(bounds(await render({ ...thickLine, cameraZ: defaults.cameraZ * 2 }), 129).height, screenBounds.height, 'screen line width', 1);
		near(bounds(await render({ ...thickLine, sizeSpace: 'world', cameraZ: defaults.cameraZ * 2 }), 129).height / bounds(await render({ ...thickLine, sizeSpace: 'world' }), 129).height, 0.5, 'world line width', 0.15);
		const faded = await render({ ...line, connectionFade: 1 });
		near(center(faded, 129)[3], 0.5 * (1 - 0.6 ** 2 * (3 - 2 * 0.6)), 'distance fade');
		checks.push('line dimensions unique edges and distance fade');

		// 【3点の閉路だけが一枚の両面三角形になり、線の表示に依存しない】
		// 全候補を採用しても重複して加算されないことと、面のSeed選択を確認する。
		const face: Partial<Parameters> = { distribution: 'plane', pointCount: 3, motionAmount: 0, showPoints: false, showLines: false, showFaces: true,
			maximumConnections: 2, connectionDistance: 10, connectionFade: 0, faceProbability: 1, shading: 0, faceColor: [2, -1, 0.5, 0.4], projection: 'orthographic' };
		const facePixels = await render(face);
		let interior = 0;
		for (let index = 0; index < facePixels.length; index += 4) {
			assert(facePixels[index + 3] <= 0.401, 'each triangle rendered once');
			if (facePixels[index + 3] < 0.399) continue;
			interior++;
			[0.8, -0.4, 0.2, 0.4].forEach((value, channel) => near(facePixels[index + channel], value, 'face HDR color'));
		}
		assert(interior > 5, 'visible triangle interior');
		near(coverage(await render({ ...face, rotationY: 0.5 })), coverage(facePixels), 'double sided face', 1);
		empty(await render({ ...face, maximumConnections: 1 }), 'no face without closed cycle');
		empty(await render({ ...face, faceProbability: 0 }), 'zero face probability');
		const selectedFaces = await render({ showPoints: false, showLines: false, faceProbability: 0.3 });
		await render({ seed: 15, time: 7 });
		equal(await render({ showPoints: false, showLines: false, faceProbability: 0.3 }), selectedFaces, 'stable face selection');
		checks.push('unique double sided closed triangles');

		// 【加算は光量を足し、深度方式は最前面だけを残す】
		// 同じ画面位置の8点を使い、透明度の二重乗算・加算alphaの範囲外・深度無視を検出する。
		const overlap: Partial<Parameters> = { ...single, pointCount: 8, extent: [0, 0], extentZ: 0.6, pointColor: [4, -2, 1, 0.5], projection: 'orthographic' };
		center(await render(overlap), 129).forEach((value, channel) => near(value, [16, -8, 4, 1 - 0.5 ** 8][channel], 'additive overlapping points', 0.01));
		center(await render({ ...overlap, renderMode: 'depth' }), 129).forEach((value, channel) => near(value, [2, -1, 0.5, 0.5][channel], 'nearest surface'));
		empty(await render({ ...overlap, pointColor: [8, -4, 2, 0] }), 'zero alpha is invisible');
		for (const visible of ['showPoints', 'showLines', 'showFaces'] as const) assert(coverage(await render({ renderMode: 'depth', showPoints: false, showLines: false, showFaces: false, [visible]: true })) > 0, `depth ${visible}`);
		checks.push('additive and depth compositing with HDR alpha');

		// 【縦横比と解像度を変えても等方的な寸法を維持する】
		// 点の円形と長辺に対するサイズを検査し、Screen Size Referenceの作用範囲も確認する。
		const wide = createEffect(129, 65); const tall = createEffect(65, 129); const large = createEffect(257, 257);
		for (const [sample, width] of [[wide, 129], [tall, 65]] as const) {
			const dimensions = bounds(await sample(single), width);
			near(dimensions.width, dimensions.height, 'isotropic circle', 1);
			near(dimensions.width, bounds(screen, 129).width, 'long side point diameter', 1);
		}
		near(coverage(await large(single)) / coverage(screen), (257 / 129) ** 2, 'resolution independent area', 0.3);
		near(coverage(await wide({ ...single, sizeReference: 'height' })) / coverage(await wide(single)), (65 / 129) ** 2, 'screen reference area', 0.04);
		equal(await wide({ ...single, sizeSpace: 'world', sizeReference: 'height' }), await wide({ ...single, sizeSpace: 'world' }), 'world size ignores screen reference');
		checks.push('resolution aspect ratio and size reference');

		// 【Near面を跨ぐ線・面、背後の点、退化したカメラでも有限の出力になる】
		// 透視除算前の線クリップと点の棄却を確認し、カメラに接近した際の巨大な発光を抑える。
		empty(await render({ ...single, positionZ: 2 }), 'point behind camera');
		empty(await render({ ...single, cameraZ: 0.005, cameraTargetZ: -1 }), 'point before near plane');
		near(center(await render({ ...single, cameraZ: 0.06, cameraTargetZ: -1, nearClip: 0.01, nearFade: 0.1 }), 129)[3], 0.5, 'near fade');
		for (const sizeSpace of ['screen', 'world'] as const) {
			assert(coverage(await render({ ...line, sizeSpace, cameraZ: 0.1, cameraTargetZ: -1, rotationY: 0.12, nearClip: 0.02, nearFade: 0.05 })) > 0, 'line clipped across near plane');
			await render({ sizeSpace, cameraZ: 0.1, cameraTargetZ: -1, motionAmount: 0.5, renderMode: 'depth' });
		}
		assert(coverage(await render({ ...face, distribution: 'grid', extent: [0.6, 0.6], extentZ: 0, cameraZ: 0.1, cameraTargetZ: -1, rotationY: 0.12, projection: 'perspective', nearClip: 0.02 })) > 0, 'face clipped across near plane');
		await render({ cameraZ: 0, cameraTargetZ: 0 });
		await render({ cameraPosition: [0, 1], cameraZ: 0 });
		for (const distribution of ['box', 'ball', 'sphere', 'plane', 'grid'] as const) assert(coverage(await render({ distribution })) > 0, `visible ${distribution}`);
		checks.push('near clipping camera degeneracies and distributions');

		// 【上限の点数・接続数を処理し、上限超過は黙って間引かない】
		// 密集した点群でも仕事量の上限内で完了し、書き出し時に形状を変えない契約を確認する。
		const stress = createEffect(65, 65);
		const stressSettings: Partial<Parameters> = { pointCount: MAX_POINT_COUNT, maximumConnections: MAX_NEIGHBOR_COUNT, connectionDistance: 5, faceProbability: 1 };
		await stress(stressSettings);
		const start = performance.now();
		assert(coverage(await stress(stressSettings)) > 0, 'maximum point count');
		const maximumFrameMilliseconds = performance.now() - start;
		for (const overrides of [{ pointCount: MAX_POINT_COUNT + 1 }, { maximumConnections: MAX_NEIGHBOR_COUNT + 1 }]) {
			let rejected = false;
			try { await stress(overrides); } catch (error) { rejected = error instanceof Error && error.message.includes('must be between'); }
			assert(rejected, 'explicit limit error');
		}
		checks.push(`bounded workload (${maximumFrameMilliseconds.toFixed(1)} ms including readback)`);

		let preview: string | null = null;
		if (includePreview) {
			const width = 480; const height = 360;
			const sample = createEffect(width, height);
			const canvas = new OffscreenCanvas(width * 2, height * 2);
			const context = canvas.getContext('2d')!;
			const variants: { label: string; params: Partial<Parameters> }[] = [
				{ label: 'Additive / Screen', params: { time: 2, rotationY: 0.06 } },
				{ label: 'Additive / 3D Space', params: { time: 2, rotationY: 0.06, sizeSpace: 'world' } },
				{ label: 'Faces Only', params: { time: 2, showPoints: false, showLines: false, faceProbability: 1, faceColor: [0.2, 0.5, 1, 0.35] } },
				{ label: 'Nearest Surface / Sphere', params: { distribution: 'sphere', pointCount: 400, motionAmount: 0.04, faceProbability: 1, maximumConnections: 8, connectionDistance: 0.3, renderMode: 'depth', faceColor: [0.05, 0.2, 0.4, 1], shading: 0.8 } },
			];
			for (const [index, variant] of variants.entries()) {
				const pixels = await sample(variant.params);
				const image = context.createImageData(width, height);
				for (let offset = 0; offset < pixels.length; offset += 4) {
					const color = linearSrgbToSrgb([pixels[offset] + 0.004 * (1 - pixels[offset + 3]), pixels[offset + 1] + 0.006 * (1 - pixels[offset + 3]), pixels[offset + 2] + 0.012 * (1 - pixels[offset + 3]), 1]);
					image.data.set([color[0] * 255, color[1] * 255, color[2] * 255, 255], offset);
				}
				const x = index % 2 * width; const y = Math.floor(index / 2) * height;
				context.putImageData(image, x, y);
				context.fillStyle = '#c5d8f1'; context.font = '16px sans-serif'; context.fillText(variant.label, x + 16, y + 28);
			}
			const blob = await canvas.convertToBlob(); const bytes = new Uint8Array(await blob.arrayBuffer());
			let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
			preview = btoa(binary);
		}
		return { checks, preview };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		await checkValidation();
		await device.popErrorScope();
		device.destroy();
	}
}
