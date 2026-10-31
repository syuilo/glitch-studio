import definition from '../../src/fx/streamlines/_def_.ts';
import implementation from '../../src/fx/streamlines/_impl_.ts';
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
		vector: constantShaderInput('vector', [1, 0]), density: 1, maximumLength: 0.3, stepSize: 0.01, maximumSteps: 256,
		minimumMagnitude: 0.000001, lineWidth: 0.01, arrowSpacing: 0.2, arrowSize: 0.04, maximumMagnitude: 1,
		ramp, zeroColor: [0, 1, 0, 0.5], overflowColor: [0.2, 0.6, 0.8, 0.25], directionSpace: 'component',
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
			async render(parameters: Partial<Parameters> = {}, time = 0) {
				device.pushErrorScope('validation');
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...defaults, ...parameters }, commandEncoder, time, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
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
	device.pushErrorScope('validation');
	const square = createRenderer(257, 257);
	const wide = createRenderer(513, 257);
	const larger = createRenderer(513, 513);
	const textures: GPUTexture[] = [];
	function createField(values: Float32Array, width: number, height: number, useFloat32 = false) {
		const texture = device.createTexture({ size: [width, height], format: useFloat32 ? 'rg32float' : 'rg16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		textures.push(texture);
		const data = useFloat32 ? values : Uint16Array.from(values, float32ToFloat16Bits);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' });
	}
	try {
		const initializationError = await device.popErrorScope();
		if (initializationError != null) throw new Error(initializationError.message);
		// 【一様場の前後追跡と長さ・終了条件】
		// seedの両側を同じ長さで描き、最大長の端数を余分な一刻みで超えないことを確認する。
		const horizontal = await square.render({ arrowSize: 0 });
		nearColor(horizontal.at(0, 0), [0, 0, 0.5, 0.5], 'exact maximum uses the last ramp color');
		assert(horizontal.at(-0.25, 0)[3] > 100 && horizontal.at(0.25, 0)[3] > 100, 'uniform field traces both directions from the seed');
		assert(horizontal.at(0.33, 0)[3] === 0 && horizontal.at(0, 0.03)[3] === 0, 'maximum length and line width bound the stroke');
		const partial = await square.render({ arrowSize: 0, maximumLength: 0.103, stepSize: 0.02 });
		assert(partial.at(0.1, 0)[3] > 100 && partial.at(0.12, 0)[3] === 0, 'partial final steps respect maximum length');
		const limited = await square.render({ arrowSize: 0, maximumSteps: 3, stepSize: 0.02 });
		assert(limited.at(0.05, 0)[3] > 100 && limited.at(0.09, 0)[3] === 0, 'maximum steps limits each direction');
		const boundary = await square.render({ maximumLength: 2, arrowSize: 0 });
		assert(boundary.at(-0.49, 0)[3] > 100 && boundary.at(0.49, 0)[3] > 100, 'integration clips its final segment to the domain boundary');
		assert(boundary.at(0.49, 0.04)[3] === 0, 'leaving the domain does not wrap the trace');
		const vertical = await square.render({ vector: constantShaderInput('vector', [0, 1]), arrowSize: 0 });
		assert(vertical.at(0, 0.2)[3] > 100 && vertical.at(0.2, 0)[3] === 0, 'uniform vertical fields are traced in Y');
		const transparent = await square.render({ lineWidth: 0 });
		assert(transparent.pixels.every(value => value === 0), 'zero line width clears the output');

		// 【弧長に基づく矢尻とベクトル方向】
		// 後方へ生成した折れ線でも元のベクトル方向の矢尻を置き、非表示や間隔の設定を反映する。
		const arrows = await square.render();
		assert(arrows.at(0.07, 0.018)[3] > 100 && arrows.at(-0.13, 0.018)[3] > 100, 'forward and backward traces share the field arrow direction');
		assert(horizontal.at(0.07, 0.018)[3] === 0, 'zero arrow size hides direction markers');
		const reversed = await square.render({ vector: constantShaderInput('vector', [-1, 0]) });
		assert(reversed.at(0.13, 0.018)[3] > 100 && reversed.at(0.07, 0.018)[3] === 0, 'negative vectors reverse the arrowheads');
		const closerArrows = await square.render({ arrowSpacing: 0.1 });
		assert(closerArrows.at(0.02, 0.018)[3] > 100 && arrows.at(0.02, 0.018)[3] === 0, 'arrow spacing changes marker positions along the curve');
		nearColor(arrows.at(0.07, 0.018), [0, 0, 0.5, 0.5], 'arrowheads do not accumulate opacity over the line');

		// 【ゼロと微小値の停止、透明度の非累積】
		// 点への退化をゼロ専用色で示し、微小な非ゼロ値を同じ色に分類しない。
		const zero = await square.render({ vector: constantShaderInput('vector', [0, 0]) });
		nearColor(zero.at(0, 0), [0, 0.5, 0, 0.5], 'zero seeds use their dedicated premultiplied color');
		assert(zero.at(0.03, 0)[3] === 0, 'zero fields terminate at a single seed dot');
		const hiddenZero = await square.render({ vector: constantShaderInput('vector', [0, 0]), zeroColor: [1, 0, 0, 0] });
		assert(hiddenZero.pixels.every(value => value === 0), 'transparent zero colors hide seed dots');
		const belowThreshold = await square.render({ vector: constantShaderInput('vector', [0.0001, 0]), minimumMagnitude: 0.001 });
		nearColor(belowThreshold.at(0, 0), [0.5, 0, 0, 0.5], 'nonzero terminated seeds retain the ramp color');
		assert(belowThreshold.at(0.03, 0)[3] === 0, 'minimum magnitude terminates weak fields');
		const weakFlow = await square.render({ vector: constantShaderInput('vector', [0.0001, 0]), minimumMagnitude: 0, arrowSize: 0 });
		assert(weakFlow.at(0.2, 0)[3] > 100, 'a zero threshold allows small nonzero fields');
		const overlap = await square.render({ density: 2, maximumLength: 1, arrowSize: 0 });
		nearColor(overlap.at(0, 0.25), [0, 0, 0.5, 0.5], 'overlapping traces do not accumulate opacity');
		const overflow = await square.render({ vector: constantShaderInput('vector', [2, 0]) });
		nearColor(overflow.at(0.2, 0), [0.05, 0.15, 0.2, 0.25], 'overflow regions use a separate premultiplied color');
		const remapped = await square.render({ vector: constantShaderInput('vector', [1, 0]), maximumMagnitude: 2 });
		nearColor(remapped.at(0.2, 0), [0.25, 0, 0.25, 0.5], 'maximum magnitude changes color without changing geometry');
		assert(remapped.at(0.29, 0)[3] > 100 && remapped.at(0.33, 0)[3] === 0, 'magnitude does not scale streamline length');

		// 【16/32bitの場の途中で変化する大きさと、解析的に円になる回転場】
		// seedの値や前フレームのbufferを再利用せず、追跡先・描画位置で現在の場を参照する。
		for (const useFloat32 of supportsFloat32 ? [false, true] : [false]) {
			const values = new Float32Array(257 * 2);
			for (let x = 0; x < 257; x++) values[x * 2] = 1 + 2 * (x - 128) / 257;
			const field = createField(values, 257, 1, useFloat32);
			const varying = await square.render({ vector: field, arrowSize: 0 });
			nearColor(varying.at(-0.25, 0), [0.25, 0, 0.25, 0.5], `${useFloat32 ? 'float32' : 'float16'} ramp changes along the same streamline`);
			nearColor(varying.at(0.25, 0), [0.05, 0.15, 0.2, 0.25], `${useFloat32 ? 'float32' : 'float16'} overflow is local to the field position`);
		}
		const vortexValues = new Float32Array(257 * 257 * 2);
		for (let y = 0; y < 257; y++) for (let x = 0; x < 257; x++) {
			const index = (y * 257 + x) * 2;
			vortexValues[index] = (y - 128) * 2 / 257;
			vortexValues[index + 1] = (x - 128) * 2 / 257;
		}
		const vortex = createField(vortexValues, 257, 257);
		const circles = await square.render({ vector: vortex, density: 3, maximumLength: 1.1, stepSize: 0.005, arrowSize: 0 });
		assert(circles.at(Math.SQRT1_2 / 3, Math.SQRT1_2 / 3)[3] > 100 && circles.at(0, 1 / 3)[3] > 100, 'RK2 follows the circular streamline of a rotational field');
		assert(circles.at(0.4, 0)[3] === 0, 'curved tracing does not drift into neighboring radii');
		nearColor(circles.at(0, 0), [0, 0.5, 0, 0.5], 'the stagnation seed remains a zero-colored dot');
		const stalledValues = new Float32Array(257 * 2);
		for (let x = 0; x < 257; x++) stalledValues[x * 2] = x < 154 ? 1 : 0;
		const stalled = await square.render({ vector: createField(stalledValues, 257, 1), arrowSize: 0 });
		assert(stalled.at(-0.2, 0)[3] > 100 && stalled.at(0.16, 0)[3] === 0, 'tracing terminates when it reaches a zero region');

		// 【縦横比・解像度・時刻とリソース再利用】
		// 座標モードで方向だけを切り替え、設定の増減や入力の種類を戻しても残像を残さない。
		const diagonal = await wide.render({ vector: constantShaderInput('vector', [0.5, 0.5]), arrowSize: 0 });
		assert(diagonal.at(0.14, 0.14)[3] > 100 && diagonal.at(0.2, 0.1)[3] === 0, 'component tracing preserves 45 degree screen directions');
		const displacement = await wide.render({ vector: constantShaderInput('vector', [0.5, 0.5]), directionSpace: 'displacement', arrowSize: 0 });
		assert(displacement.at(0.2, 0.1)[3] > 100 && displacement.at(0.14, 0.14)[3] === 0, 'displacement tracing reflects the output aspect ratio');
		nearColor(displacement.at(0, 0), diagonal.at(0, 0).map(value => value / 255), 'direction space does not change magnitude colors');
		const scaled = await larger.render({ arrowSize: 0 });
		assert(scaled.at(0.25, 0)[3] > 100 && scaled.at(0.33, 0)[3] === 0 && scaled.at(0, 0.03)[3] === 0, 'streamline geometry scales with rendering resolution');
		const repeated = await square.render({ arrowSize: 0 }, 100);
		assert(repeated.pixels.every((value, index) => value === horizontal.pixels[index]), 'rendering is independent of history and time after input and capacity changes');
		return { checks };
	} finally {
		square.dispose(); wide.dispose(); larger.dispose();
		for (const texture of textures) texture.destroy();
		device.destroy();
	}
}
