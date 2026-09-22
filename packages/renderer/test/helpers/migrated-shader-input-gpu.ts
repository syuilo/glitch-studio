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
	const effects = [[dataMixDefinition, dataMix], [colorBlendDefinition, colorBlend], [dataBlendDefinition, dataBlend], [composeVectorDefinition, composeVector], [remapDefinition, remap], [multiplyDefinition, multiply], [rgbToDefinition, rgbTo], [snoiseDefinition, snoise], [channelShiftDefinition, channelShift], [chromaticAberrationDefinition, chromaticAberration], [colorBlocksDefinition, colorBlocks], [lcdDefinition, lcd], [rainDropsOnWindow1Definition, rainDropsOnWindow1], [rainDropsOnWindow2Definition, rainDropsOnWindow2], [vectorDisplacementDefinition, vectorDisplacement]] as const;
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
	return completed;
}
