import blendCode from '@gs/shared/color-blend.wgsl?raw';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { colorBlendModes } from '@gs/shared/color-blend.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import adaptiveBlockGlitchDefinition from '../../src/fx/adaptiveBlockGlitch/_def_.ts';
import adaptiveBlockGlitch from '../../src/fx/adaptiveBlockGlitch/_impl_.ts';
import bloomDefinition from '../../src/fx/bloom/_def_.ts';
import bloom from '../../src/fx/bloom/_impl_.ts';
import colorClampDefinition from '../../src/fx/colorClamp/_def_.ts';
import colorClamp from '../../src/fx/colorClamp/_impl_.ts';
import contentErrorPropagationDefinition from '../../src/fx/contentErrorPropagation/_def_.ts';
import contentErrorPropagation from '../../src/fx/contentErrorPropagation/_impl_.ts';
import frameDifferenceDefinition from '../../src/fx/frameDifference/_def_.ts';
import frameDifference from '../../src/fx/frameDifference/_impl_.ts';
import frequencyTransplantDefinition from '../../src/fx/frequencyTransplant/_def_.ts';
import frequencyTransplant from '../../src/fx/frequencyTransplant/_impl_.ts';
import multiscaleGlitchDefinition from '../../src/fx/multiscaleGlitch/_def_.ts';
import multiscaleGlitch from '../../src/fx/multiscaleGlitch/_impl_.ts';
import type { EffectDefinition } from '../../src/effect-definition.ts';
import type { EffectImplementation } from '../../src/effect-implementation.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const resolution = { width: 16, height: 16 };
	const checks: string[] = [];
	const disposers: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const readPipeline = device.createRenderPipeline({
		layout: 'auto', vertex: { module: vertex },
		fragment: { targets: [{ format: 'rgba32float' }], module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(image, vec2i(position.xy), 0);
}` }) },
	});

	async function read(texture: GPUTexture): Promise<number[]> {
		// 8bitへの読み戻しでは今回検証するHDR・負値が消えるため、float32へコピーする。
		const bytesPerRow = Math.ceil(texture.width * 16 / 256) * 256;
		const target = device.createTexture({ size: [texture.width, texture.height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [texture.width, texture.height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const values = new Float32Array(buffer.getMappedRange());
			return Array.from({ length: texture.height }, (_, row) => Array.from(values.slice(row * bytesPerRow / 4, row * bytesPerRow / 4 + texture.width * 4))).flat();
		} finally { buffer.destroy(); target.destroy(); }
	}

	function checkPixels(name: string, actual: number[], expected: readonly number[], tolerance = 0.005) {
		assert(actual.length > 0 && actual.length % 4 === 0, `${name}: missing RGBA pixels`);
		actual.forEach((value, index) => assert(Number.isFinite(value) && Math.abs(value - expected[index % 4]) <= tolerance, `${name}: channel ${index} = ${value}, expected ${expected[index % 4]}`));
		checks.push(name);
	}

	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
	disposers.push(() => fallbackTexture.destroy());

	function createEffect(definition: EffectDefinition, implementation: EffectImplementation, enable32bitDataTextures: boolean, overrides: Record<string, unknown>) {
		const params = { ...Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
			parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])), ...overrides };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures };
		const texture = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params, resources: {}, fallbackTexture, reportStatus: status => {
			if (status.type === 'error') throw new Error(status.message);
		} });
		disposers.push(() => { instance.dispose(); texture.destroy(); });
		return async (changes: Record<string, unknown> = {}) => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...params, ...changes }, commandEncoder: encoder, time: 0, timeDelta: 1000 / 60,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }),
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: (commandEncoder, descriptor) => commandEncoder.beginComputePass(descriptor),
			});
			device.queue.submit([encoder.finish()]);
			return read(texture);
		};
	}

	try {
		const blendBuffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const blendTarget = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		disposers.push(() => { blendBuffer.destroy(); blendTarget.destroy(); });
		const blendPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
			targets: [{ format: 'rgba16float' }], module: device.createShaderModule({ code: blendCode + `
struct Colors { background: vec4f, foreground: vec4f, mode: u32 };
@group(0) @binding(0) var<uniform> colors: Colors;
@fragment fn fs() -> @location(0) vec4f { return blendColor(colors.mode, colors.background, colors.foreground); }` }),
		} });
		const blendGroup = device.createBindGroup({ layout: blendPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: blendBuffer } }] });

		async function blend(mode: keyof typeof colorBlendModes, background: number[], foreground: number[]) {
			const values = new Float32Array(12);
			values.set(background);
			values.set(foreground, 4);
			new Uint32Array(values.buffer)[8] = colorBlendModes[mode];
			device.queue.writeBuffer(blendBuffer, 0, values);
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: blendTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(blendPipeline);
			pass.setBindGroup(0, blendGroup);
			pass.draw(3);
			pass.end();
			device.queue.submit([encoder.finish()]);
			return read(blendTarget);
		}

		// 【通常合成・四則演算・EmissionはHDRと負値を保持し、alphaを色の強さとして扱わない】
		// 半透明色や負の差分が途中で失われると、後段で露出を下げても元の階調へ戻せない。
		checkPixels('normal preserves premultiplied HDR and negative RGB', await blend('normal', [2, -1, 0.5, 1], [1.5, -0.25, 0.125, 0.5]), [2.5, -0.75, 0.375, 1]);
		for (const [mode, expected] of [['add', [2.5, -0.75, -1.5, 1]], ['subtract', [1.5, -1.25, 2.5, 1]], ['multiply', [1, -0.25, -1, 1]]] as const) {
			checkPixels(`${mode} preserves extended RGB`, await blend(mode, [2, -1, 0.5, 1], [0.5, 0.25, -2, 1]), expected);
		}
		checkPixels('emission adds light while composing coverage', await blend('emission', [1.5, -0.5, 0.25, 0.5], [1, -0.25, 0.5, 0.25]), [2.5, -0.75, 0.75, 0.625]);
		// 【HSLとColor Dodgeはそれぞれの定義域・演算の飽和を維持する】
		// 一律の出力clampを外す変更で、モード固有の色域や特異点処理まで消してはいけない。
		checkPixels('HSL color retains its normalized color domain', await blend('color', [0.5, 0.5, 0.5, 1], [2, -1, -1, 1]), [1, 2 / 7, 2 / 7, 1]);
		checkPixels('color dodge retains its intrinsic saturation', await blend('colorDodge', [0.5, 0.5, 0.5, 1], [2, -1, 0.5, 1]), [1, 0.25, 1, 1]);

		for (const enable32bitDataTextures of supports32bit ? [false, true] : [false]) {
			const label = `${enable32bitDataTextures ? 32 : 16}bit data`;
			const input = constantShaderInput('color', [4, -3, 2, 0.5]);
			const expected = [2, -1.5, 1, 0.5];
			// 【処理対象となったブロック・帯域も、色の変化が0ならHDR入力をそのまま保つ】
			// エフェクト全体のバイパスだけを検証すると、処理領域だけに残ったclampを検出できない。
			const adaptive = createEffect(adaptiveBlockGlitchDefinition, adaptiveBlockGlitch, enable32bitDataTextures, { input, amount: 1, strength: 1, colorShift: 0, channelShift: 0, displacement: 0, outline: 0, subdivisions: 1, analysisSamples: 1 });
			checkPixels(`${label} adaptive blocks preserve unchanged HDR`, await adaptive(), expected);
			const multiscale = createEffect(multiscaleGlitchDefinition, multiscaleGlitch, enable32bitDataTextures, { input, probability: 1, colorCorruption: 0, fineEnabled: true, mediumEnabled: true, coarseEnabled: true, fineAmount: 1, mediumAmount: 1, coarseAmount: 1, fineShift: [1, 1], mediumShift: [1, 1], coarseShift: [1, 1] });
			checkPixels(`${label} multiscale bands reconstruct HDR`, await multiscale(), expected);
			// 【周波数移植の差分が0なら、半透明の入力のHDR・負値とalphaを保持する】
			// 同じ画像を副入力にしても、復元後の0〜1制限で元画像を変えてはいけない。
			const transplant = createEffect(frequencyTransplantDefinition, frequencyTransplant, enable32bitDataTextures, { input, donor: input, preserveDetails: true, blockSize: 25 });
			checkPixels(`${label} frequency transplant preserves identical extended colors`, await transplant(), expected);
			// 【誤差が実際に加算された画素でも、元のHDRと負値を切り捨てずalphaを維持する】
			// 誤差の発生しないバイパスだけで通ることを防ぎ、十分に範囲外の入力で全画素を確認する。
			const propagation = createEffect(contentErrorPropagationDefinition, contentErrorPropagation, enable32bitDataTextures, { input, sourceProbability: 1, sourceSize: 1, sourceSpacing: 25, analysisResolution: 16, steps: 1 });
			const propagated = await propagation();
			assert(propagated.some((value, index) => index % 4 < 3 && Math.abs(value - expected[index % 4]) > 0.01), 'color errors must reach some pixels');
			for (let index = 0; index < propagated.length; index += 4) {
				assert(Number.isFinite(propagated[index]) && propagated[index] > 1 && propagated[index + 1] < 0 && propagated[index + 3] === 0.5, 'propagated HDR or alpha was clipped');
			}
			checks.push(`${label} propagated errors preserve HDR negative RGB and alpha`);
			// 【Bloomは光量を1で飽和させず、alphaだけを被覆率の範囲へ制限する】
			// 明るい半透明入力でRGBとalphaをまとめて制限する誤りと、強度0の古い画像の再利用を検出する。
			const glow = createEffect(bloomDefinition, bloom, enable32bitDataTextures, { input, threshold: 0, softKnee: 0, strength: 2, radius: [0, 0], inputBlendMode: 'replace' });
			checkPixels(`${label} bloom retains light above one with bounded alpha`, await glow(), [4, 0, 2, 1]);
			checkPixels(`${label} zero bloom replaces with transparent output`, await glow({ strength: 0 }), [0, 0, 0, 0]);
			checkPixels(`${label} zero bloom normal blend preserves its input`, await glow({ strength: 0, inputBlendMode: 'normal' }), expected);
			// 【Frame Differenceは閾値以下を0にし、差分の強度が1を超えても保持する】
			// 上限を外す変更で負の差分を作ったり、履歴の量子化誤差を静止画像の動きにしてはいけない。
			const difference = createEffect(frameDifferenceDefinition, frameDifference, enable32bitDataTextures, { input: constantShaderInput('color', [2, -0.5, 0.25, 1]), gain: 4, threshold: 0.25 });
			await difference();
			const black = constantShaderInput('color', [0, 0, 0, 1]);
			checkPixels(`${label} frame differences retain magnitude above one`, await difference({ input: black }), [7, 1, 0, 1]);
			checkPixels(`${label} unchanged frames settle to zero`, await difference({ input: black }), [0, 0, 0, 1]);
			// 【Color Clampによる明示的な色の範囲制限は維持する】
			// 保存形式に由来する制限の撤去で、範囲を制限するエフェクト本来の機能を変えてはいけない。
			const limited = createEffect(colorClampDefinition, colorClamp, enable32bitDataTextures, { input });
			checkPixels(`${label} explicit color clamp still limits straight RGB`, await limited(), [0.5, 0, 0.5, 0.5]);
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		for (const dispose of disposers.toReversed()) dispose();
		device.destroy();
	}
}
