import definition from '../../src/fx/imageTrap/_def_.ts';
import implementation from '../../src/fx/imageTrap/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
	const checks: string[] = [];
	const resources: (() => void)[] = [];
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		mapParameterTree<ValueParameterBinding>(parameter, parameter.defaultValue, [], (field, binding) => {
			if (binding.inputSource !== 'literal') throw new Error('Expected literal test defaults');
			return 'canNode' in field && field.canNode === true ? constantShaderInput(field.dataType.kind, binding.value) : structuredClone(binding.value);
		}),
	])) as Parameters;
	const assert = (condition: boolean, label: string) => {
		if (!condition) throw new Error(label);
		checks.push(label);
	};
	const nearColor = (actual: number[], expected: readonly number[], label: string, tolerance = 0.0015) => assert(actual.every((value, channel) => Number.isFinite(value) && Math.abs(value - expected[channel]) <= tolerance), `${label}: ${actual} ~= ${expected}`);
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }],
	} });
	function createImage(width: number, height: number, pixel: (u: number, v: number) => number[]) {
		const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = new Uint16Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const color = pixel((x + 0.5) / width, (y + 0.5) / height);
				values.set(color.map(float32ToFloat16Bits), (y * width + x) * 4);
			}
		}
		device.queue.writeTexture({ texture }, values, { bytesPerRow: width * 8 }, [width, height]);
		resources.push(() => texture.destroy());
		return (sampling: Partial<ShaderInputSampling> = {}) => textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear', ...sampling });
	}
	const gradient = createImage(256, 128, (u, v) => [u * 0.5, (1 - v) * 0.5, 0.125, 0.5]);
	function createRenderer(width: number, height: number) {
		const resolution = { width, height };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const rowBytes = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const group = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		resources.push(() => { instance.dispose(); output.destroy(); copy.destroy(); buffer.destroy(); });
		return {
			async render(overrides: Partial<Parameters> = {}, clock = 0, delta = 0) {
				device.pushErrorScope('validation');
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time: clock, timeDelta: delta,
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
					createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				});
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copy.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(reader); pass.setBindGroup(0, group); pass.draw(3); pass.end();
				encoder.copyTextureToBuffer({ texture: copy }, { buffer, bytesPerRow: rowBytes }, resolution);
				device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Float32Array(buffer.getMappedRange().slice(0));
				buffer.unmap();
				const error = await device.popErrorScope();
				if (error != null) throw new Error(error.message);
				return {
					pixels,
					pixel(x = (width - 1) / 2, y = (height - 1) / 2) { return Array.from(pixels.slice(y * rowBytes / 4 + x * 4, y * rowBytes / 4 + x * 4 + 4)); },
				};
			},
		};
	}
	try {
		const single = createRenderer(1, 1);
		const orbit: Partial<Parameters> = { input: gradient(), formula: 'julia', juliaConstant: [0, 0], view: { ...defaults.view, center: [0.5, 0] }, trapSize: [0.5, 0.5], maximumIterations: 2, iterationDecay: 1 };
		// 【z0=1/2, c=0の軌道は1/4, 1/16となり、合成順ごとのRGBAを解析的に求められる】
		// 半透明を不透明と誤認した早期終了や、RGBへのalpha二重乗算を検出する。
		for (const [compositeMode, expected] of [
			['firstOnTop', [0.4453125, 0.375, 0.1875, 0.75]],
			['lastOnTop', [0.421875, 0.375, 0.1875, 0.75]],
			['maximumAlpha', [0.3125, 0.25, 0.125, 0.5]],
		] as const) {
			nearColor((await single.render({ ...orbit, compositeMode })).pixel(), expected, `${compositeMode} analytic two-step orbit`);
		}
		const decayed = await single.render({ ...orbit, iterationDecay: 0.5 });
		nearColor(decayed.pixel(), [0.37890625, 0.3125, 0.15625, 0.625], 'decay scales premultiplied samples');
		const faded = await single.render({ ...orbit, opacity: 0.5 });
		nearColor(faded.pixel(), [0.255859375, 0.21875, 0.109375, 0.4375], 'sample opacity is applied before compositing');
		for (const compositeMode of ['firstOnTop', 'lastOnTop', 'maximumAlpha'] as const) {
			nearColor((await single.render({ ...orbit, compositeMode, iterationDecay: 0 })).pixel(), [0.3125, 0.25, 0.125, 0.5], `${compositeMode} zero decay keeps first selected sample`);
		}
		// 【最大alphaは、同順位なら最初の反復を保ち、より不透明な後続画像なら置き換える】
		// 最初の非透明サンプルやRGBの明るさで選ぶ実装になっていないことを確認する。
		const varyingAlpha = createImage(256, 1, u => [u * (1 - u), 0, 0, 1 - u]);
		nearColor((await single.render({ ...orbit, input: varyingAlpha(), compositeMode: 'maximumAlpha' })).pixel(), [0.53125 * 0.46875, 0, 0, 0.46875], 'maximum alpha selects later more opaque sample');
		const opaqueGradient = createImage(256, 1, u => [u, 0, 0, 1]);
		nearColor((await single.render({ ...orbit, input: opaqueGradient(), compositeMode: 'lastOnTop' })).pixel(), [0.53125, 0, 0, 1], 'last on top continues after an opaque sample');
		// 【開始反復はzを更新した後の1から数え、除外した反復へDecayを適用しない】
		// Mandelbrotの共通初期値z0=0を描くと画像全体が同じ色になるので、最初の更新後から照合する。
		nearColor((await single.render({ ...orbit, firstIteration: 2, iterationDecay: 0.5 })).pixel(), [0.265625, 0.25, 0.125, 0.5], 'first iteration skips sampling without consuming decay');
		nearColor((await single.render({ ...orbit, firstIteration: 3 })).pixel(), [0, 0, 0, 0], 'empty iteration range is transparent');
		nearColor((await single.render({ input: gradient(), formula: 'mandelbrot', view: { ...defaults.view, center: [1, 0] }, maximumIterations: 1, trapSize: [0.1, 0.1] })).pixel(), [0, 0, 0, 0], 'Mandelbrot does not sample its shared zero initial state');
		// 【大きいJulia定数で戻れる軌道を早すぎる発散と誤認しない】
		// c=-6, z0=3は3の固定点。半径2だけで打ち切ると2回目の半透明合成が失われる。
		const red = constantShaderInput('color', [1, 0, 0, 0.5]);
		nearColor((await single.render({ input: red, formula: 'julia', juliaConstant: [-6, 0], view: { ...defaults.view, center: [3, 0] }, trapPosition: [0.75, 0], maximumIterations: 2, iterationDecay: 1, bailoutRadius: 2 })).pixel(), [0.75, 0, 0, 0.75], 'Julia escape bound accounts for the constant');
		nearColor((await single.render({ input: red, formula: 'julia', juliaConstant: [0, 0], view: { ...defaults.view, center: [Math.sqrt(3), 0] }, trapPosition: [0.75, 0], maximumIterations: 10, iterationDecay: 1, bailoutRadius: 2 })).pixel(), [0.5, 0, 0, 0.5], 'escaping final point is sampled once');
		// 【Mandelbrotの1回目はz=cなので、座標変換の正解を画像の既知勾配から直接求められる】
		// Trap Size・Positionは共通単位、両方のRotationはturn単位で時計回りに表示する。
		const direct: Partial<Parameters> = { input: gradient(), formula: 'mandelbrot', maximumIterations: 1, trapSize: [1, 1], iterationDecay: 1 };
		nearColor((await single.render(direct)).pixel(), [0.25, 0.25, 0.125, 0.5], 'Mandelbrot first image maps to the complex point');
		nearColor((await single.render({ ...direct, trapPosition: [0.125, 0] })).pixel(), [0.1875, 0.25, 0.125, 0.5], 'trap translation uses common spatial units');
		nearColor((await single.render({ ...direct, view: { ...defaults.view, center: [0.5, 0] }, trapSize: [0.5, 1] })).pixel(), [0.375, 0.25, 0.125, 0.5], 'trap size scales the source rectangle');
		for (const rotation of ['rotation', 'trapRotation'] as const) {
			const parameters = rotation === 'rotation' ? { view: { ...defaults.view, rotation: 0.25 } } : { trapRotation: 0.25 };
			nearColor((await single.render({ ...direct, coordinateOffset: constantShaderInput('vector', [0.125, 0]), ...parameters })).pixel(), [0.25, 0.3125, 0.125, 0.5], `${rotation} rotates reference coordinates counterclockwise`);
		}
		nearColor((await single.render({ ...direct, view: { ...defaults.view, zoom: 2 }, coordinateOffset: constantShaderInput('vector', [0.125, 0]) })).pixel(), [0.28125, 0.25, 0.125, 0.5], 'coordinate offsets are applied before zoom');
		// 【出力の縦横比と解像度を変えても、共通座標の同じ点で画像の形とfitを維持する】
		// 素材のfitを出力画面へかけると、同じTrap Sizeでも画像の切り取りや寸法が変わってしまう。
		for (const [width, height] of [[9, 9], [9, 5], [5, 9], [27, 27]]) {
			const pixels = await createRenderer(width, height).render(direct);
			const offset = width === 27 ? 3 : 1;
			nearColor(pixels.pixel((width - 1) / 2 + offset, (height - 1) / 2), [0.25 + 0.5 / 9, 0.25, 0.125, 0.5], `${width}x${height} isotropic X`);
			nearColor(pixels.pixel((width - 1) / 2, (height - 1) / 2 - offset), [0.25, 0.25 + 0.5 / 9, 0.125, 0.5], `${width}x${height} isotropic positive Y`);
		}
		// 【トラップの矩形外は常に透明とし、矩形内では接続のFit/Wrap/Filterを維持する】
		// clamp/repeatが有限矩形の外まで広がるのを防ぎつつ、containの余白には指定したwrapを適用する。
		for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored', 'transparent'] as const) {
			nearColor((await single.render({ ...direct, input: gradient({ wrapMode }), view: { ...defaults.view, center: [3, 0] } })).pixel(), [0, 0, 0, 0], `${wrapMode} does not extend the trap rectangle`);
		}
		nearColor((await single.render({ ...direct, input: red, view: { ...defaults.view, center: [3, 0] } })).pixel(), [0, 0, 0, 0], 'constant colors use the same finite trap rectangle');
		const fitted: Partial<Parameters> = { ...direct, view: { ...defaults.view, center: [0, 1.5] } };
		nearColor((await single.render({ ...fitted, input: gradient({ fitMode: 'contain', wrapMode: 'transparent' }) })).pixel(), [0, 0, 0, 0], 'contain fits against trap dimensions and keeps transparent margins');
		const repeated = await single.render({ ...fitted, input: gradient({ fitMode: 'contain', wrapMode: 'repeat' }) });
		assert(Math.abs(repeated.pixel()[3] - 0.5) < 0.001, 'repeat fills contain margins within the trap');
		const twoColors = createImage(2, 1, u => u < 0.5 ? [1, 0, 0, 1] : [0, 0, 1, 1]);
		nearColor((await single.render({ ...direct, input: twoColors() })).pixel(), [0.5, 0, 0.5, 1], 'linear input filtering is preserved');
		nearColor((await single.render({ ...direct, input: twoColors({ filterMode: 'nearest' }) })).pixel(), [0, 0, 1, 1], 'nearest input filtering is preserved');
		// 【AAでは各標本を合成してから平均し、境界の半透明被覆を維持する】
		// 1x1の4標本のうち2点だけが矩形内になる配置で、alphaとRGBが同じ割合で減ることを確認する。
		nearColor((await single.render({ ...direct, input: red, view: { ...defaults.view, center: [1, 0] }, trapSize: [0.5, 0.5], antialiasing: true })).pixel(), [0.25, 0, 0, 0.25], 'AA averages premultiplied coverage at trap bounds');
		nearColor((await single.render({ ...direct, antialiasing: true })).pixel(), [0.25, 0.25, 0.125, 0.5], 'AA preserves transparent image colors');
		// 【同じインスタンスの入力・式・時刻切替で残像や履歴依存を生じさせない】
		// テクスチャから定数・透明な未接続値へ切り替えた後も、元の入力に戻せることを確認する。
		const original = await single.render(orbit, 1, 1000 / 30);
		nearColor((await single.render({ ...direct, input: constantShaderInput('color', [0.8, 0.2, 0.4, 0.25]) })).pixel(), [0.2, 0.05, 0.1, 0.25], 'constant input is premultiplied once');
		nearColor((await single.render({ ...direct, input: defaults.input })).pixel(), [0, 0, 0, 0], 'unconnected input clears the image');
		nearColor((await single.render({ ...orbit, opacity: 0 })).pixel(), [0, 0, 0, 0], 'zero opacity clears the image');
		const repeat = await single.render(orbit, 100, 1000 / 120);
		assert(repeat.pixels.every((value, index) => value === original.pixels[index]), 'render order time and frame rate do not change the image');
		return { checks };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
