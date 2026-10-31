import definition from '../../src/fx/vectorFieldVisualization/_def_.ts';
import implementation from '../../src/fx/vectorFieldVisualization/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supportsFloat32 = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supportsFloat32 ? ['float32-filterable'] : [] });
	const wgpu = { device, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }) };
	const checks: string[] = [];
	const assert = (condition: boolean, label: string) => {
		if (!condition) throw new Error(label);
		checks.push(label);
	};
	const ramp: ColorRamp = { interpolation: 'linear', colorSpace: 'srgb', stops: [
		{ id: 'start', position: 0, color: [1, 0, 0, 0.5] },
		{ id: 'end', position: 1, color: [0, 0, 1, 0.5] },
	] };
	const defaults: Parameters = {
		vector: constantShaderInput('vector', [0, 0]), density: 1, maximumMagnitude: 1, lineWidth: 0.04,
		ramp, zeroColor: [0, 1, 0, 0.5], overflowColor: [0.2, 0.6, 0.8, 0.25], directionSpace: 'component', gridWidth: 0, gridColor: [1, 1, 1, 0.5],
	};
	const nearColor = (actual: number[], expected: number[], label: string) => assert(actual.every((value, channel) => Math.abs(value - expected[channel] * 255) <= 2), `${label}: ${actual}`);
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba8unorm' }] } });
	function createRenderer(width: number, height: number) {
		const resolution = { width, height };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const copyTarget = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const rowBytes = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, reportStatus: () => {}, fallbackTexture: output });
		return {
			async render(parameters: Partial<Parameters> = {}) {
				device.pushErrorScope('validation');
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...defaults, ...parameters }, commandEncoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor), createComputePassEncoder: encoder => encoder.beginComputePass(),
					createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(6); pass.end();
				commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow: rowBytes }, resolution);
				device.queue.submit([commandEncoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Uint8Array(buffer.getMappedRange()).slice();
				buffer.unmap();
				const error = await device.popErrorScope();
				if (error != null) throw new Error(error.message);
				return {
					pixels,
					pixel(x: number, y: number) { return Array.from(pixels.subarray(y * rowBytes + x * 4, y * rowBytes + x * 4 + 4)); },
					at(x: number, y: number) {
						const column = Math.round((width - 1) / 2 + x * Math.min(width, height));
						const row = Math.round((height - 1) / 2 - y * Math.min(width, height));
						return Array.from(pixels.subarray(row * rowBytes + column * 4, row * rowBytes + column * 4 + 4));
					},
				};
			},
			dispose() { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); },
		};
	}
	const square = createRenderer(257, 257);
	const wide = createRenderer(513, 257);
	const larger = createRenderer(513, 513);
	try {
		// 【ゼロの点と太さの連続性】
		// 矢尻がゼロでも残ったり、透明度が重ね描きで濃くなったりしないことを実画素で確認する。
		// 専用色は厳密なゼロだけに適用し、微小な非ゼロ値や透明な専用色も正しく区別する。
		const zero = await square.render();
		nearColor(zero.at(0, 0), [0, 0.5, 0, 0.5], 'zero uses its dedicated premultiplied color');
		assert(zero.at(0.04, 0)[3] === 0 && zero.at(0, 0.04)[3] === 0, 'zero is a dot without an arrowhead');
		const transparentZero = await square.render({ zeroColor: [1, 0, 0, 0] });
		assert(transparentZero.pixels.every(value => value === 0), 'transparent zero color hides zero vectors');
		const tiny = await square.render({ vector: constantShaderInput('vector', [1e-20, 0]) });
		nearColor(tiny.at(0, 0), [0.5, 0, 0, 0.5], 'tiny nonzero vectors still use the ramp');
		const thicker = await square.render({ lineWidth: 0.1 });
		assert(thicker.at(0.04, 0)[3] > 100 && thicker.at(0, 0.04)[3] > 100, 'line width also controls dot diameter');
		const hidden = await square.render({ lineWidth: 0 });
		assert(hidden.pixels.every(value => value === 0), 'zero line width leaves a transparent output');

		// 【大きさの上限を長さ・Ramp・超過色で共有する】
		// 上限と一致する値を超過色にせず、上限超過時にも設定色のalphaを一度だけ乗算する。
		const half = await square.render({ vector: constantShaderInput('vector', [0.5, 0]) });
		nearColor(half.at(0, 0), [0.25, 0, 0.25, 0.5], 'half magnitude uses the ramp midpoint');
		assert(half.at(0.17, 0)[3] > 100 && half.at(0.23, 0)[3] === 0, 'half magnitude has half the shaft length');
		const maximum = await square.render({ vector: constantShaderInput('vector', [1, 0]) });
		nearColor(maximum.at(0, 0), [0, 0, 0.5, 0.5], 'exact maximum uses the last ramp color');
		assert(maximum.at(-0.35, 0)[3] > 100 && maximum.at(0.35, 0)[3] > 100, 'the shaft is centered on the cell');
		assert(maximum.at(0.2, 0.108)[3] > 100 && maximum.at(-0.2, 0.108)[3] === 0, 'only the positive endpoint has an arrowhead');
		const negative = await square.render({ vector: constantShaderInput('vector', [-1, 0]) });
		assert(negative.at(-0.2, 0.108)[3] > 100 && negative.at(0.2, 0.108)[3] === 0, 'negative vectors reverse the arrowhead');
		const up = await square.render({ vector: constantShaderInput('vector', [0, 1]) });
		assert(up.at(0.108, 0.2)[3] > 100 && up.at(0.108, -0.2)[3] === 0, 'positive Y points upward');
		const overflow = await square.render({ vector: constantShaderInput('vector', [2, 0]) });
		nearColor(overflow.at(0, 0), [0.05, 0.15, 0.2, 0.25], 'overflow uses its own premultiplied color');
		nearColor(overflow.at(0.2, 0.108), [0.05, 0.15, 0.2, 0.25], 'the arrowhead uses the same overflow color');
		assert(overflow.at(0.39, 0)[3] > 0 && overflow.at(0.43, 0)[3] === 0, 'overflow length stays bounded inside the cell');
		const remapped = await square.render({ vector: constantShaderInput('vector', [1, 0]), maximumMagnitude: 2 });
		assert(remapped.pixels.every((value, index) => value === half.pixels[index]), 'maximum magnitude adjusts length and color together');
		const largeVector = await square.render({ vector: constantShaderInput('vector', [1e30, 1e30]) });
		nearColor(largeVector.at(0, 0), [0.05, 0.15, 0.2, 0.25], 'large finite vector components do not overflow the length calculation');

		// 【セル中心からのデータ入力と密度】
		// セル内の各画素の値で矢印が曲がらず、16/32bitのデータ用テクスチャをそのまま読めることを確認する。
		for (const useFloat32 of supportsFloat32 ? [false, true] : [false]) {
			const values = new Float32Array(257 * 2);
			for (let i = 0; i < 257; i++) values[i * 2 + 1] = 1;
			values[128 * 2] = 0.5; values[128 * 2 + 1] = 0;
			const texture = device.createTexture({ size: [257, 1], format: useFloat32 ? 'rg32float' : 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			try {
				const data = useFloat32 ? values : Uint16Array.from(values, float32ToFloat16Bits);
				device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength }, [257, 1]);
				const vector = textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
				const sampled = await square.render({ vector });
				assert(sampled.pixels.every((value, index) => value === half.pixels[index]), `${useFloat32 ? 'float32' : 'float16'} field is sampled at the cell center`);
			} finally { texture.destroy(); }
		}
		const dense = await square.render({ density: 3, lineWidth: 0.12 });
		nearColor(dense.at(1 / 3, 0), [0, 0.5, 0, 0.5], 'density places another dot one cell away');
		assert(zero.at(1 / 3, 0)[3] === 0, 'density changes the sampling lattice');

		// 【グリッドの太さと透明度】
		// 0ではアンチエイリアスの線も残さず、幅を増やすと境界の両側へ等しく広がる。
		// 交差点は二重合成せず、半透明なグリッドの色とalphaを保つ。
		const grid = await square.render({ gridWidth: 0.01, density: 2, lineWidth: 0 });
		assert(grid.at(0.25, 0)[3] > 0 && grid.at(0.1, 0.1)[3] === 0, 'positive grid width draws cell boundaries on a transparent background');
		const thickGrid = await square.render({ gridWidth: 0.1, density: 2, lineWidth: 0, gridColor: [0.4, 0.8, 1, 0.5] });
		assert(grid.at(0.23, 0)[3] === 0 && thickGrid.at(0.23, 0)[3] > 100 && thickGrid.at(0.27, 0)[3] > 100, 'grid width controls both sides of a boundary');
		nearColor(thickGrid.at(0.25, 0), [0.2, 0.4, 0.5, 0.5], 'grid color is premultiplied once');
		nearColor(thickGrid.at(0.25, 0.25), [0.2, 0.4, 0.5, 0.5], 'grid intersections do not accumulate alpha');

		// 【解像度と縦横比に依存しない図形・方向モード】
		// 長方形でも点とセルを歪めず、変位方向の補正が大きさや配色へ混入しないことを確認する。
		const diagonal = await wide.render({ vector: constantShaderInput('vector', [0.5, 0.5]) });
		assert(diagonal.at(-0.13, -0.13)[3] > 100 && diagonal.at(-0.2, -0.1)[3] === 0, 'component direction stays at 45 degrees on a wide output');
		const displacement = await wide.render({ vector: constantShaderInput('vector', [0.5, 0.5]), directionSpace: 'displacement' });
		assert(displacement.at(-0.2, -0.1)[3] > 100 && displacement.at(-0.13, -0.13)[3] === 0, 'displacement direction reflects the output aspect ratio');
		nearColor(displacement.at(0, 0), diagonal.at(0, 0).map(value => value / 255), 'direction space preserves the magnitude color');
		const wideDot = await wide.render({ lineWidth: 0.1 });
		assert(wideDot.at(0.04, 0)[3] > 100 && wideDot.at(0, 0.04)[3] > 100 && wideDot.at(0.06, 0)[3] === 0, 'dots remain circular on a wide output');
		const scaled = await larger.render({ vector: constantShaderInput('vector', [1, 0]) });
		assert(scaled.at(0.35, 0)[3] > 100 && scaled.at(0.43, 0)[3] === 0 && scaled.at(0.2, 0.108)[3] > 100, 'arrow geometry scales with output resolution');
		const repeated = await square.render({ vector: constantShaderInput('vector', [1, 0]) });
		assert(repeated.pixels.every((value, index) => value === maximum.pixels[index]), 'repeated rendering is deterministic');
		return { checks };
	} finally {
		square.dispose(); wide.dispose(); larger.dispose(); device.destroy();
	}
}
