import definition from '../../src/fx/bakersMap/_def_.ts';
import implementation from '../../src/fx/bakersMap/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	const colors = [[0, 0, 0, 0], [2, -1, 0.5, 0.5], [-2, 4, 1, 1], [0.25, 0.5, -1, 0.25], [1, -0.5, 2, 0.75]];
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const defaults: Parameters = {
		input: constantShaderInput('color', definition.paramDefs.input.defaultValue.value),
		iterations: definition.paramDefs.iterations.defaultValue.value,
		direction: definition.paramDefs.direction.defaultValue.value,
		axis: definition.paramDefs.axis.defaultValue.value,
	};
	function compare(actual: Float32Array, expected: ArrayLike<number>, label: string) {
		if (actual.length !== expected.length) throw new Error(`${label}: dimensions differ`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - expected[index]) > 0.001) throw new Error(`${label}/${index}: ${value} != ${expected[index]}`);
		});
	}
	const compareColors = (actual: Float32Array, labels: number[], label: string) => compare(actual, labels.flatMap(index => colors[index]), label);
	const rows = (labels: number[], width: number) => labels.flatMap(label => Array<number>(width).fill(label));
	const columns = (labels: number[], height: number) => Array.from({ length: height }, () => labels).flat();
	function image(width: number, height: number, labels: number[], sampling: Partial<ShaderInputSampling> = {}) {
		const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture }, new Float16Array(labels.flatMap(index => colors[index])), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			effect.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: 1000 / 30,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}
	try {
		const input = image(2, 2, [1, 2, 3, 4]);
		const render = createEffect(4, 4);
		const directions = ['forward', 'inverse'] as const;
		const axes = ['x', 'y'] as const;

		// 【0回は軸・順逆によらず恒等変換】座標の回転や正規化だけが残る誤りを検出する。
		for (const direction of directions) for (const axis of axes) {
			compareColors(await render({ input, iterations: 0, direction, axis }), [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4], 'zero iterations');
		}
		checks.push('zero iterations preserve the input for all directions and axes');

		// 【4通りの向きとHDR・透明度】既知の4色がどの帯へ移るかを手計算した配置と比較する。
		// 半透明・負値・1を超える成分も含め、順逆の取り違えやalphaの二重乗算を検出する。
		compareColors(await render({ input, iterations: 1 }), rows([2, 4, 1, 3], 4), 'forward X');
		compareColors(await render({ input, iterations: 1, direction: 'inverse' }), columns([3, 4, 1, 2], 4), 'inverse X');
		compareColors(await render({ input, iterations: 1, axis: 'y' }), columns([1, 2, 3, 4], 4), 'forward Y');
		compareColors(await render({ input, iterations: 1, axis: 'y', direction: 'inverse' }), rows([1, 3, 2, 4], 4), 'inverse Y');
		checks.push('known one-step layouts in four orientations preserve HDR and alpha');

		// 【複数回でも元画像から直接参照する】途中の低解像度画像を使うと色を失うため、
		// 2回の結果に元の4色が残る配置を使って座標だけの反復を確認する。
		const larger = createEffect(8, 8);
		compareColors(await larger({ input, iterations: 2 }), rows([2, 4, 1, 3, 2, 4, 1, 3], 8), 'two forward X steps');
		compareColors(await larger({ input, iterations: 2, direction: 'inverse' }), columns([3, 4, 1, 2, 3, 4, 1, 2], 8), 'two inverse X steps');
		compareColors(await larger({ input, iterations: 2, axis: 'y' }), columns([1, 2, 3, 4, 1, 2, 3, 4], 8), 'two forward Y steps');
		compareColors(await larger({ input, iterations: 2, axis: 'y', direction: 'inverse' }), rows([1, 3, 2, 4, 1, 3, 2, 4], 8), 'two inverse Y steps');
		checks.push('multiple iterations sample the original image directly');

		// 【長方形と解像度の変更でも領域全体を分割する】中央の正方形だけに作用する誤りや、
		// 入力の画素数を反復単位に使う誤りを、縦長・横長・小さい出力で検出する。
		for (const [width, height] of [[8, 4], [4, 8], [12, 8], [8, 12]]) {
			const rectangle = createEffect(width, height);
			compareColors(await rectangle({ input, iterations: 1 }), rows(Array.from({ length: height }, (_, y) => [2, 4, 1, 3][Math.floor((y + 0.5) * 4 / height)]), width), `rectangular X ${width}x${height}`);
			compareColors(await rectangle({ input, iterations: 1, axis: 'y' }), columns(Array.from({ length: width }, (_, x) => [1, 2, 3, 4][Math.floor((x + 0.5) * 4 / width)]), height), `rectangular Y ${width}x${height}`);
		}
		// 1画素の軸は画素中心が切断線と一致する。floorの定義では後半の領域に属し、
		// 参照点は入力の外周へ移る。ここではClampによりその側の端の画素を読む。
		compareColors(await createEffect(8, 1)({ input, iterations: 1 }), Array<number>(8).fill(4), 'single row on the X cut');
		compareColors(await createEffect(1, 8)({ input, iterations: 1, axis: 'y' }), Array<number>(8).fill(2), 'single column on the Y cut');
		checks.push('rectangular and resized outputs use the full domain');

		// 【反復数の丸め・上下限】式やキーが小数や範囲外の値でも、不定な小数回や無制限の
		// ループにしない。上限での出力が有限であることも全方向で確認する。
		for (const direction of directions) for (const axis of axes) {
			for (const [iterations, expected] of [[-10, 0], [1.49, 1], [1.5, 2], [1e9, 16]]) {
				compare(await larger({ input, iterations, direction, axis }), await larger({ input, iterations: expected, direction, axis }), 'rounded and bounded iterations');
			}
		}
		checks.push('iterations round to integers and remain within zero to sixteen');

		// 【定数・透明・テクスチャの切替と描画履歴の独立性】別の値・時刻を描画した後でも、
		// 同一インスタンスで古いbindingやuniformを使わず、入力だけから結果を再現する。
		compareColors(await render(), Array<number>(16).fill(0), 'unconnected transparent input');
		compareColors(await render({ input: constantShaderInput('color', [4, -2, 1, 0.5]), iterations: 16 }), Array<number>(16).fill(1), 'constant premultiplied HDR');
		compareColors(await render({ input: image(2, 2, [0, 2, 3, 4]), iterations: 1 }), rows([2, 4, 0, 3], 4), 'transparent texture pixels');
		compareColors(await render({ input, iterations: 1 }, 100), rows([2, 4, 1, 3], 4), 'deterministic texture after other renders');
		checks.push('constant texture and transparent inputs update without render history');

		// 【線形補間は元画像を一度だけ補間する】nearestとの差を既知の重みで比較し、
		// Filter切替を無視したり、切断後の色を再補間したりする実装を検出する。
		const stripe = image(2, 1, [0, 1]);
		compareColors(await render({ input: stripe, iterations: 1 }), rows([1, 1, 0, 0], 4), 'nearest sampling');
		const weights = [0.625, 0.875, 1, 1, 0.625, 0.875, 1, 1, 0, 0, 0.125, 0.375, 0, 0, 0.125, 0.375];
		compare(await render({ input: { ...stripe, filterMode: 'linear' }, iterations: 1 }), weights.flatMap(weight => colors[1].map(value => value * weight)), 'linear sampling');
		checks.push('nearest and linear filters apply once at the transformed position');

		// 【Fit後の余白にも接続のWrapを適用する】縦長入力をContainすると、変換後の参照点が
		// 画像の左右へ出る。透明・繰り返し・端伸長・鏡像を変えて既存の入力規約を確認する。
		const tall = image(2, 4, [1, 2, 1, 2, 1, 2, 1, 2], { fitMode: 'contain' });
		for (const wrapMode of ['clamp', 'repeatMirrored', 'repeat', 'transparent'] as const) {
			const top = wrapMode === 'transparent' ? [2, 2, 2, 2, 0, 0, 0, 0] : wrapMode === 'repeat' ? [2, 2, 2, 2, 1, 1, 1, 1] : Array<number>(8).fill(2);
			const bottom = wrapMode === 'transparent' ? [0, 0, 0, 0, 1, 1, 1, 1] : wrapMode === 'repeat' ? top : Array<number>(8).fill(1);
			compareColors(await larger({ input: { ...tall, wrapMode }, iterations: 1 }), [...columns(top, 4), ...columns(bottom, 4)], `contain and ${wrapMode}`);
		}
		checks.push('contain fit preserves transparent repeat clamp and mirrored wrapping');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
