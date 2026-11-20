import { distanceFieldInput } from '../../distance-field-input.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const sdf = distanceFieldInput(inputs.sdf, resolution);
		const aspectRatio = resolution.width / resolution.height;
		// 差分幅を入力の1画素より狭くすると、低解像度SDFやnearest入力で
		// 勾配がほぼ0になる。出力・入力の大きい方の1画素を最小半径にする。
		const pixelGradientStep = sdf.size != null
			? [Math.max(2 / resolution.width, 2 / (sdf.size.width * sdf.scale[0])), Math.max(2 / resolution.height, 2 / (sdf.size.height * sdf.scale[1]))]
			: [2 / resolution.width, 2 / resolution.height];
		uniformValues.set({
			distanceToHeight: Math.max(resolution.width, resolution.height) / resolution.height,
		});
		return createFullscreenEffect(context, {
			code,
			inputs: { input: inputs.input, sdf: sdf.binding },
			internalLayouts: [layout],
			sampling: 'level0',
			schema: { input: 'color', sdf: 'scalar' },
			bindResources(pass) {
				const angle = inputs.lightAngle.value * Math.PI * 2;
				// 屈折モデル内部の高さ単位へ、共通SDFとガラスの寸法指定をそれぞれ換算する。
				const referenceScale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / resolution.height;
				const normalSmoothing = Number.isFinite(inputs.normalSmoothing.value) ? Math.max(0, inputs.normalSmoothing.value) * referenceScale : 0;
				uniformValues.set({
					sdfScale: sdf.scale,
					// 高さ基準の半径を画面座標[-1,+1]へ変換し、Xだけ縦横比を補正する。
					// SDF自体は変えず、屈折方向・照明用の上下左右4点だけを遠くへ移す。
					// 0では従来の差分幅を維持し、サンプル数・パス・中間テクスチャも増やさない。
					gradientStep: [Math.max(pixelGradientStep[0], 2 * normalSmoothing / aspectRatio), Math.max(pixelGradientStep[1], 2 * normalSmoothing)],
					aspectRatio,
					transparentSdf: sdf.transparent ? 1 : 0,
					refractionModel: { quadratic: 0, curvedSurface: 1 }[inputs.refractionModel.value],
					refraction: Math.max(0, inputs.refraction.value),
					thickness: Math.max(0, inputs.thickness.value) * referenceScale,
					curvature: Math.max(2, Math.min(6, inputs.curvature.value)),
					ior: Math.max(1, Math.min(2, inputs.ior.value)),
					edgeSoftness: Math.max(0, inputs.edgeSoftness.value) * referenceScale,
					blur: Math.max(0, inputs.blur.value) * referenceScale,
					blurSamples: Math.max(1, Math.min(128, Math.round(inputs.blurSamples.value))),
					aberration: Math.max(0, inputs.aberration.value),
					// 分散範囲全体の点数。RGBすべてに正の重みを持たせるため最低3点必要。
					aberrationSamples: Number.isFinite(inputs.aberrationSamples.value)
						? Math.max(3, Math.min(64, Math.round(inputs.aberrationSamples.value))) : 3,
					innerZoom: Math.max(0.001, inputs.innerZoom.value),
					innerZoomCenter: spatialToNormalizedCoordinates(inputs.innerZoomCenter.value, resolution),
					lightDirection: [Math.cos(angle), -Math.sin(angle)],
					highlight: Math.max(0, inputs.highlight.value),
					highlightColor: inputs.highlightColor.value,
					highlightSoftness: Math.max(0, Math.min(1, inputs.highlightSoftness.value)),
					fresnel: Math.max(0, inputs.fresnel.value),
					fresnelSoftness: Math.max(0, Math.min(1, inputs.fresnelSoftness.value)),
					fresnelColor: inputs.fresnelColor.value,
					tintColor: inputs.tintColor.value,
					tintIntensity: Math.max(0, Math.min(1, inputs.tintIntensity.value)),
					tintPreserveLuminosity: inputs.tintPreserveLuminosity.value ? 1 : 0,
					cutout: inputs.cutout.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
