import linearDefinition from '../../src/fx/linearWipe/_def_.ts';
import linearImplementation from '../../src/fx/linearWipe/_impl_.ts';
import irisDefinition from '../../src/fx/irisWipe/_def_.ts';
import irisImplementation from '../../src/fx/irisWipe/_impl_.ts';
import radialDefinition from '../../src/fx/radialWipe/_def_.ts';
import radialImplementation from '../../src/fx/radialWipe/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { EffectImplementation } from '../../src/effect-implementation.ts';

const effects = {
	linear: { definition: linearDefinition, implementation: linearImplementation },
	iris: { definition: irisDefinition, implementation: irisImplementation },
	radial: { definition: radialDefinition, implementation: radialImplementation },
};

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.002) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	// 未乗算の入力から期待する乗算済み色を明示する。HDR・負値・異なるalphaを含む。
	const inputA = constantShaderInput('color', [4, -2, 1, 0.5]);
	const inputB = constantShaderInput('color', [-2, 4, 0, 0.25]);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
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

	function textureInput(width: number, height: number, values: number[], scalarTexture = false) {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'clamp' });
	}

	const fallback = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
	disposables.push(() => fallback.destroy());

	function createEffect(name: keyof typeof effects, width = 65, height = 65, precise = true) {
		const { definition } = effects[name];
		// テスト用の共通呼出し境界。実装本体の型は各定義に対して検査される。
		const implementation = effects[name].implementation as EffectImplementation;
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const defaults = {
			...Object.fromEntries(Object.entries(definition.paramDefs).map(([key, parameter]) => [key,
				'canNode' in parameter && parameter.canNode === true
					? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)
					: structuredClone(parameter.defaultValue.value),
			])),
			inputA, inputB, progress: scalar(0.5),
		};
		const textures = new Map<string, GPUTexture>();
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: fallback, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); for (const texture of textures.values()) texture.destroy(); });
		return async (overrides: Record<string, unknown> = {}, mode: 'color' | 'mask' | 'both' = 'both', time = 0) => {
			const keys = mode === 'both' ? ['output', 'mask'] : [mode === 'color' ? 'output' : 'mask'];
			const outputDataMap = Object.fromEntries(keys.map(key => {
				let texture = textures.get(key);
				if (texture == null) {
					texture = implementation.outputTextureFactories[key]({ wgpu, resolution });
					textures.set(key, texture);
				}
				if (key === 'mask') assert(texture.format === (precise ? 'r32float' : 'r16float'), 'mask precision');
				return [key, { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null }];
			}));
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 }, outputDataMap,
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			device.queue.submit([encoder.finish()]);
			const color = mode === 'mask' ? new Float32Array() : await read(textures.get('output')!);
			const maskPixels = mode === 'color' ? new Float32Array() : await read(textures.get('mask')!);
			const mask = Float32Array.from({ length: maskPixels.length / 4 }, (_, index) => maskPixels[index * 4]);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(`${name}: ${error.message}`);
			assert(color.every(Number.isFinite), 'finite color');
			assert(mask.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'bounded finite mask');
			return { color, mask };
		};
	}

	try {
		// 【完全な端点と連続した接続】大きいFeatherや画面外の中心でも、
		// 進捗の端だけ強制したために残像が突然消える実装を検出する。
		for (const name of ['linear', 'iris', 'radial'] as const) {
			for (const precise of [false, true]) {
				const render = createEffect(name, 33, 17, precise);
				for (const feather of [0, 0.8]) {
					for (const progress of [-1, 0, 1, 2]) {
						const result = await render({ progress: scalar(progress), feather, center: [0.9, -0.6], angle: 0.13 });
						const endpoint = progress <= 0 ? 0 : 1;
						assert(result.mask.every(value => value === endpoint), `${name} exact mask endpoint`);
						result.color.forEach((value, index) => near(value, (endpoint === 0 ? colorA : colorB)[index % 4], 'exact input endpoint', 0));
					}
					const nearStart = await render({ progress: scalar(0.00001), feather, center: [0.9, -0.6] }, 'mask');
					const nearEnd = await render({ progress: scalar(0.99999), feather, center: [0.9, -0.6] }, 'mask');
					assert(nearStart.mask.every(value => value < 0.01) && nearEnd.mask.every(value => value > 0.99), `${name} continuous endpoints`);
				}
				checks.push(`${name} ${precise ? 32 : 16}bit endpoints`);

				// 【MaskとRGBAの補間が一致し、単独出力でも同じ結果になる】
				// 半透明画像の二重乗算・HDRのclamp・未使用ポート参照を検出する。
				const baseline = await render({ feather: 0.3 });
				baseline.mask.forEach((mask, index) => {
					for (let channel = 0; channel < 4; channel++) near(baseline.color[index * 4 + channel], colorA[channel] * (1 - mask) + colorB[channel] * mask, 'mask equals color weight');
				});
				equal((await render({ feather: 0.3 }, 'color')).color, baseline.color, 'color only');
				equal((await render({ feather: 0.3 }, 'mask', 100)).mask, baseline.mask, 'mask only and deterministic');
				const maskOnly = createEffect(name, 33, 17, precise);
				equal((await maskOnly({ feather: 0.3 }, 'mask')).mask, baseline.mask, 'mask without color allocation');
				const transparent = await render({ inputB: constantShaderInput('color', [8, -3, 2, 0]), feather: 0.3 });
				transparent.mask.forEach((mask, index) => {
					for (let channel = 0; channel < 4; channel++) near(transparent.color[index * 4 + channel], colorA[channel] * (1 - mask), 'transparent replacement');
				});
				checks.push(`${name} ${precise ? 32 : 16}bit mixing and lazy outputs`);
			}

			// 【画像・進捗のテクスチャ接続】実際の入力pipelineの切替とサンプリングを通す。
			// 左右を0/1にした進捗で、幾何形状にかかわらずA/Bを画素ごとに選ぶ。
			const render = createEffect(name, 8, 4);
			const progressValues = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
			const inputValues = Array.from({ length: 32 }, (_, index) => [index / 8, -0.25, 0.5, 0.5]).flat();
			const result = await render({
				inputA: textureInput(8, 4, inputValues),
				inputB: textureInput(1, 1, colorB),
				progress: textureInput(8, 4, progressValues, true),
			});
			progressValues.forEach((progress, index) => {
				near(result.mask[index], progress, 'texture progress');
				for (let channel = 0; channel < 4; channel++) near(result.color[index * 4 + channel], progress === 0 ? inputValues[index * 4 + channel] : colorB[channel], 'texture color');
			});
			checks.push(`${name} texture inputs`);
		}

		// 【Linearの方向・円の等方性】縦長・横長の両方で共通座標を使い、
		// 角度0の上向き進行、右向き進行と円の縦横半径を既知の点で確認する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const centerX = (width - 1) / 2;
			const centerY = (height - 1) / 2;
			const indexAt = (x: number, y: number) => (centerY - y) * width + centerX + x;
			const linear = createEffect('linear', width, height);
			const upward = await linear({}, 'mask');
			near(upward.mask[indexAt(0, -8)], 1, 'upward lower region');
			near(upward.mask[indexAt(0, 8)], 0, 'upward upper region');
			near(upward.mask[indexAt(0, 0)], 0.5, 'zero feather antialias');
			const rightward = await linear({ angle: 0.25 }, 'mask');
			near(rightward.mask[indexAt(-8, 0)], 1, 'rightward left region');
			near(rightward.mask[indexAt(8, 0)], 0, 'rightward right region');
			const iris = createEffect('iris', width, height);
			const outward = await iris({ feather: 0.4 }, 'mask');
			near(outward.mask[indexAt(8, 0)], outward.mask[indexAt(0, 8)], 'isotropic circle');
			const inward = await iris({ feather: 0.4, direction: 'inward' }, 'mask');
			outward.mask.forEach((mask, index) => near(mask + inward.mask[index], 1, 'inward reverse at midpoint'));
			const reference = await iris({ feather: 0.4 * height / 65 }, 'mask');
			const heightReference = await iris({ feather: 0.4, sizeReference: 'height' }, 'mask');
			equal(reference.mask, heightReference.mask, 'size reference distance');
			checks.push(`${width}x${height} directions circle and size reference`);
		}

		// 【同じ比率で解像度を変えても同じ形状】画素中心が一致する3倍解像度で
		// Featherを十分広げ、AA以外の座標や長さが画素数へ依存しないことを確認する。
		for (const name of ['linear', 'iris', 'radial'] as const) {
			const parameters = { feather: 0.3, progress: scalar(0.37) };
			const low = await createEffect(name, 33, 17)(parameters, 'mask');
			const high = await createEffect(name, 99, 51)(parameters, 'mask');
			for (let y = 0; y < 17; y++) {
				for (let x = 0; x < 33; x++) near(low.mask[y * 33 + x], high.mask[(y * 3 + 1) * 99 + x * 3 + 1], 'resolution independence');
			}
		}
		checks.push('resolution independence');

		const radial = createEffect('radial');
		const sampleRadial = async (x: number, y: number, parameters: Record<string, unknown> = {}) => {
			const result = await radial({ center: [-x, -y], ...parameters }, 'mask');
			return result.mask[32 * 65 + 32];
		};
		// 【Radialの3方向とBothの開き幅】始端から両側へ開く意味を固定し、
		// Bothで速度が倍になる、または単に反対側から開く実装を検出する。
		for (const [direction, right, left] of [['clockwise', 1, 0], ['counterclockwise', 0, 1], ['both', 1, 1]] as const) {
			near(await sampleRadial(0.1, 0.2, { direction, progress: scalar(0.25) }), right, 'radial right', 0);
			near(await sampleRadial(-0.1, 0.2, { direction, progress: scalar(0.25) }), left, 'radial left', 0);
		}
		near(await sampleRadial(0, 0.2, { direction: 'both' }), 1, 'both upper half');
		near(await sampleRadial(0, -0.2, { direction: 'both' }), 0, 'both lower half');
		near(await sampleRadial(0.2, 0, { direction: 'both' }), 0.5, 'both 180 degree span');
		near(await sampleRadial(0.2, -0.1, { startAngle: 0.25, progress: scalar(0.25) }), 1, 'start angle clockwise');
		checks.push('radial directions and start angle');

		// 【距離Featherと角度Featherの違い】始端から同じ弧長だけ離れた点では
		// 距離モードの値は等しく、角度モードでは半径に応じて値が変わる。
		for (const radius of [0.15, 0.35]) {
			const arcDistance = 0.01;
			const angle = arcDistance / radius;
			const x = radius * Math.sin(angle);
			const y = radius * Math.cos(angle);
			near(await sampleRadial(x, y, { feather: 0.08 }), 0.625, 'distance feather arc width');
			near(await sampleRadial(x, y, { feather: 0.1, featherUnit: 'angle' }), 0.5 + angle / (2 * Math.PI * 0.1), 'angular feather width');
			near(await sampleRadial(-x, y, { feather: 0.08 }), 0.375, 'feather across start seam');
		}
		near(await sampleRadial(0.1, 0.2, { feather: 1, featherUnit: 'angle', progress: scalar(0.3) }), 0.3, 'full circle average');
		near(await sampleRadial(0, 0, { progress: scalar(0.3) }), 0.3, 'center average');
		const wrapBaseline = await radial({ startAngle: 0.9, feather: 0.2 }, 'mask');
		equal((await radial({ startAngle: -0.1, feather: 0.2 }, 'mask')).mask, wrapBaseline.mask, 'wrapped start angle');
		checks.push('radial feather units seam and center');

		// 【全方向で進捗が単調にBを増やす】大きいFeatherと画面外中心を含め、
		// ぼかしの重なりや一周の継ぎ目で一度現れたBがAへ戻らないことを検証する。
		for (const direction of ['clockwise', 'counterclockwise', 'both']) {
			let previous = new Float32Array(65 * 65);
			for (const progress of [0.001, 0.1, 0.4, 0.7, 0.999]) {
				const result = await radial({ direction, progress: scalar(progress), feather: 0.8, center: [0.7, 0.1] }, 'mask');
				assert(result.mask.every((value, index) => value + 0.00001 >= previous[index]), 'monotonic sweep');
				previous = result.mask;
			}
		}
		checks.push('radial monotonic progress');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

