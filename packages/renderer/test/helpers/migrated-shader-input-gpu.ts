import blockShuffle from '../../../shared/src/effects/blockShuffle/_impl_.ts';
import blockShuffleDefinition from '../../../shared/src/effects/blockShuffle/_def_.ts';
import dataMix from '../../../shared/src/effects/dataMix/_impl_.ts';
import dataMixDefinition from '../../../shared/src/effects/dataMix/_def_.ts';
import colorBlend from '../../../shared/src/effects/colorBlend/_impl_.ts';
import colorBlendDefinition from '../../../shared/src/effects/colorBlend/_def_.ts';
import dataBlend from '../../../shared/src/effects/dataBlend/_impl_.ts';
import dataBlendDefinition from '../../../shared/src/effects/dataBlend/_def_.ts';
import composeVector from '../../../shared/src/effects/composeVector/_impl_.ts';
import composeVectorDefinition from '../../../shared/src/effects/composeVector/_def_.ts';
import remap from '../../../shared/src/effects/remap/_impl_.ts';
import remapDefinition from '../../../shared/src/effects/remap/_def_.ts';
import multiply from '../../../shared/src/effects/multiply/_impl_.ts';
import multiplyDefinition from '../../../shared/src/effects/multiply/_def_.ts';
import rgbTo from '../../../shared/src/effects/rgbTo/_impl_.ts';
import rgbToDefinition from '../../../shared/src/effects/rgbTo/_def_.ts';
import snoise from '../../../shared/src/effects/snoise/_impl_.ts';
import snoiseDefinition from '../../../shared/src/effects/snoise/_def_.ts';
import channelShift from '../../../shared/src/effects/channelShift/_impl_.ts';
import channelShiftDefinition from '../../../shared/src/effects/channelShift/_def_.ts';
import chromaticAberration from '../../../shared/src/effects/chromaticAberration/_impl_.ts';
import chromaticAberrationDefinition from '../../../shared/src/effects/chromaticAberration/_def_.ts';
import colorBlocks from '../../../shared/src/effects/colorBlocks/_impl_.ts';
import colorBlocksDefinition from '../../../shared/src/effects/colorBlocks/_def_.ts';
import lcd from '../../../shared/src/effects/lcd/_impl_.ts';
import lcdDefinition from '../../../shared/src/effects/lcd/_def_.ts';
import rainDropsOnWindow1 from '../../../shared/src/effects/rainDropsOnWindow1/_impl_.ts';
import rainDropsOnWindow1Definition from '../../../shared/src/effects/rainDropsOnWindow1/_def_.ts';
import rainDropsOnWindow2 from '../../../shared/src/effects/rainDropsOnWindow2/_impl_.ts';
import rainDropsOnWindow2Definition from '../../../shared/src/effects/rainDropsOnWindow2/_def_.ts';
import vectorDisplacement from '../../../shared/src/effects/vectorDisplacement/_impl_.ts';
import vectorDisplacementDefinition from '../../../shared/src/effects/vectorDisplacement/_def_.ts';
import { constantShaderInput, textureShaderInput } from '../../../shared/src/shader-input.ts';
import { float32ToFloat16Bits } from '../../../shared/src/utility/float32ToFloat16Bits.ts';

// 同じ値のuniformとtextureを全組合せで切り替える。
// WGSLの型だけでなく、binding位置・チャンネル・premultiplyの違いも検出する。
export async function checkMigratedEffects(device: GPUDevice, vertex: GPUShaderModule, readOutput: (output: GPUTexture) => Promise<number[]>) {
	const effects = [[blockShuffleDefinition, blockShuffle], [dataMixDefinition, dataMix], [colorBlendDefinition, colorBlend], [dataBlendDefinition, dataBlend], [composeVectorDefinition, composeVector], [remapDefinition, remap], [multiplyDefinition, multiply], [rgbToDefinition, rgbTo], [snoiseDefinition, snoise], [channelShiftDefinition, channelShift], [chromaticAberrationDefinition, chromaticAberration], [colorBlocksDefinition, colorBlocks], [lcdDefinition, lcd], [rainDropsOnWindow1Definition, rainDropsOnWindow1], [rainDropsOnWindow2Definition, rainDropsOnWindow2], [vectorDisplacementDefinition, vectorDisplacement]] as const;
	const completed: string[] = [];
	for (const enable32bitDataTextures of [false, true]) {
		if (enable32bitDataTextures && !device.features.has('float32-filterable')) continue;
		for (const [definition, implementation] of effects) {
			device.pushErrorScope('validation');
			const textures: GPUTexture[] = [];
			const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm', enable32bitDataTextures };
			const context = { wgpu, resolution: { width: 8, height: 4 } } as any;
			const instance = implementation.init(context);
			try {
				const params: Record<string, any> = {};
				const inputs: { name: string; uniform: any; texture: any }[] = [];
				for (const [name, param] of Object.entries(definition.paramDefs) as [string, any][]) {
					if (!param.canNode) {
						params[name] = param.defaultValue.inputSource === 'literal' ? param.defaultValue.value : 0;
						continue;
					}
					const value = param.dataType === 'color' ? [0.5, 0.25, 0.125, 0.5] : param.dataType === 'vector' ? [0.5, 0.25] : param.dataType === 'any' ? null : name.endsWith('Min') ? 0 : name.endsWith('Max') ? 1 : 0.25;
					const uniform = constantShaderInput(param.dataType, value);
					// 汎用データ入力は未接続の0だけでなく複数チャンネルを検証する。
					if (param.dataType === 'any' && uniform.kind === 'uniform') uniform.value = [0.25, 0.5, 0.125, 1];
					if (uniform.kind !== 'uniform') throw new Error('Expected uniform');
					const texture = device.createTexture({ size: [1, 1], format: enable32bitDataTextures ? 'rgba32float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
					textures.push(texture);
					const values = Array.from({ length: 4 }, (_, i) => uniform.value[i] ?? (i === 3 ? 1 : 0));
					const bytes = enable32bitDataTextures ? new Float32Array(values) : new Uint16Array(values.map(float32ToFloat16Bits));
					device.queue.writeTexture({ texture }, bytes, {}, [1, 1]);
					inputs.push({ name, uniform, texture: textureShaderInput(texture) });
				}
				const output = implementation.outputTextureFactories.output!(context);
				textures.push(output);
				let baseline: number[] | undefined;
				// 最後にuniform構成へ戻し、キャッシュ退避後の再生成も検証する。
				for (let iteration = 0; iteration <= 2 ** inputs.length; iteration++) {
					const mask = iteration % (2 ** inputs.length);
					inputs.forEach((input, i) => { params[input.name] = mask & (1 << i) ? input.texture : input.uniform; });
					const encoder = device.createCommandEncoder();
					instance.render({ params, commandEncoder: encoder, outputDataMap: { output: { texture: output, textureView: output.createView() } }, createPassEncoderFor: (_: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }) } as any);
					device.queue.submit([encoder.finish()]);
					const pixels = await readOutput(output);
					baseline ??= pixels;
					if (pixels.some((value, index) => Math.abs(value - baseline![index]) > 1)) throw new Error(definition.id + ': uniform/texture mismatch for variant ' + mask);
				}
				const error = await device.popErrorScope();
				if (error) throw new Error(definition.id + ': ' + error.message);
				completed.push(definition.id + (enable32bitDataTextures ? ' 32bit' : ' 16bit'));
			} catch (error) {
				throw new Error(definition.id + ': ' + String(error), { cause: error });
			} finally {
				instance.dispose();
				for (const texture of textures) texture.destroy();
			}
		}
	}
	completed.push(...await checkChromaticAspectRatio(device, vertex, readOutput));
	return completed;
}

// 長方形の出力を、同じ物理スケールの正方形の中央領域と比較する。
// 定数画像では検出できないStart・Normalize・Vectorの方向依存を実画素で検証する。
async function checkChromaticAspectRatio(device: GPUDevice, vertex: GPUShaderModule, readOutput: (output: GPUTexture) => Promise<number[]>) {
	const completed: string[] = [];
	const instance = chromaticAberration.init({ wgpu: { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' } } as any);
	async function draw(width: number, height: number, scale: number, fitMode: string, normalize: boolean, start = 0.2) {
		const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const output = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
		try {
			// 出力サイズによらず、中心からの同じ距離が同じRGBになる入力を用意する。
			const pixels = new Uint8Array(width * height * 4);
			for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
				const px = (x + 0.5 - width / 2) / scale;
				const py = (y + 0.5 - height / 2) / scale;
				pixels.set([128 + 80 * px, 128 + 80 * py, 128 + 40 * (px + py), 255], (y * width + x) * 4);
			}
			device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: width * 4 }, [width, height]);
			const params = { input: textureShaderInput(source, { fitMode: 'stretch', wrapMode: 'clamp' }), fitMode, normalize, start,
				amount: 0.12, rStrength: 1, gStrength: 1.5, bStrength: 2, samples: 4, vector: [0.2, -0.15] };
			const encoder = device.createCommandEncoder();
			instance.render({ params, commandEncoder: encoder, outputDataMap: { output: { texture: output, textureView: output.createView() } },
				createPassEncoderFor: (_: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }) } as any);
			device.queue.submit([encoder.finish()]);
			return await readOutput(output);
		} finally { source.destroy(); output.destroy(); }
	}
	try {
		for (const fitMode of ['cover', 'contain']) for (const normalize of [false, true]) {
			const side = fitMode === 'cover' ? 129 : 65;
			const square = await draw(side, side, side, fitMode, normalize);
			for (const [width, height] of [[129, 65], [65, 129]]) {
				const rectangle = await draw(width, height, side, fitMode, normalize);
				// 入力の端のclampが比較に混ざらない中央領域を使う。
				for (let y = -24; y <= 24; y++) for (let x = -24; x <= 24; x++) for (let c = 0; c < 4; c++) {
					const a = square[((Math.floor(side / 2) + y) * side + Math.floor(side / 2) + x) * 4 + c];
					const b = rectangle[((Math.floor(height / 2) + y) * width + Math.floor(width / 2) + x) * 4 + c];
					if (Math.abs(a - b) > 2) throw new Error(`Chromatic aspect mismatch: ${fitMode}, normalize=${normalize}, ${width}x${height}, ${x},${y}`);
				}
			}
			completed.push(`chromatic aspect ${fitMode} normalize=${normalize}`);
		}
		// 中心のNormalizeとStart=1がNaNを生成せず、元の中心色を保つ。
		const center = await draw(65, 65, 65, 'stretch', true, 1);
		if (center.slice((32 * 65 + 32) * 4, (32 * 65 + 32) * 4 + 4).some((v, i) => Math.abs(v - [128, 128, 128, 255][i]) > 1)) throw new Error('Chromatic center is not finite');
		completed.push('chromatic normalized center');
	} finally { instance.dispose(); }
	return completed;
}
