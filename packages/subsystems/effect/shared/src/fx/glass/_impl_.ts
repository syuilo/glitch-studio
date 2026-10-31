import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import { implementEffect } from '../../effect-implementation.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = shapeDistanceCode + '\n' + shaderCode;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', sdf: 'scalar' }, sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: wgpu.intermediateTextureFormat }],
		});
		return {
			render: ctx => {
				const params = ctx.params;
				const { sdf } = params;
				const output = ctx.outputDataMap.output.texture;
				const sdfScale = sdf.kind === 'texture' ? inputUvScale(sdf.texture, output, sdf.fitMode) : [1, 1];
				const transparentSdf = sdf.kind === 'texture' && sdf.wrapMode === 'transparent';
				// SDFを透明色0へ混ぜると偽の輪郭になるため、値は端で延長して読む。
				// シェーダーで元の入力領域の矩形と交差させ、余白の距離と勾配も保つ。
				const distanceInput = transparentSdf ? { ...sdf, wrapMode: 'clamp' as const } : sdf;
				const angle = params.lightAngle * Math.PI * 2;
				const aspectRatio = output.width / output.height;
				// 差分幅を入力の1画素より狭くすると、低解像度SDFやnearest入力で
				// 勾配がほぼ0になる。出力・入力の大きい方の1画素を最小半径にする。
				const pixelGradientStep = sdf.kind === 'texture'
					? [Math.max(2 / output.width, 2 / (sdf.texture.width * sdfScale[0])), Math.max(2 / output.height, 2 / (sdf.texture.height * sdfScale[1]))]
					: [2 / output.width, 2 / output.height];
				// SDFの高さ単位は維持し、ガラスの寸法指定を同じ単位へ変換する。
				const referenceScale = getSizeReferenceLength(params.sizeReference, output) / output.height;
				const normalSmoothing = Number.isFinite(params.normalSmoothing) ? Math.max(0, params.normalSmoothing) * referenceScale : 0;
				uniformValues.set({
					sdfScale,
					// 高さ基準の半径を画面座標[-1,+1]へ変換し、Xだけ縦横比を補正する。
					// SDF自体は変えず、屈折方向・照明用の上下左右4点だけを遠くへ移す。
					// 0では従来の差分幅を維持し、サンプル数・パス・中間テクスチャも増やさない。
					gradientStep: [Math.max(pixelGradientStep[0], 2 * normalSmoothing / aspectRatio), Math.max(pixelGradientStep[1], 2 * normalSmoothing)],
					aspectRatio,
					transparentSdf: transparentSdf ? 1 : 0,
					refractionModel: { quadratic: 0, curvedSurface: 1 }[params.refractionModel],
					refraction: Math.max(0, params.refraction),
					thickness: Math.max(0, params.thickness) * referenceScale,
					curvature: Math.max(2, Math.min(6, params.curvature)),
					ior: Math.max(1, Math.min(2, params.ior)),
					edgeSoftness: Math.max(0, params.edgeSoftness) * referenceScale,
					blur: Math.max(0, params.blur) * referenceScale,
					blurSamples: Math.max(1, Math.min(128, Math.round(params.blurSamples))),
					aberration: Math.max(0, params.aberration),
					// 分散範囲全体の点数。RGBすべてに正の重みを持たせるため最低3点必要。
					aberrationSamples: Number.isFinite(params.aberrationSamples)
						? Math.max(3, Math.min(64, Math.round(params.aberrationSamples))) : 3,
					innerZoom: Math.max(0.001, params.innerZoom),
					innerZoomCenter: params.innerZoomCenter,
					lightDirection: [Math.cos(angle), -Math.sin(angle)],
					highlight: Math.max(0, params.highlight),
					highlightColor: params.highlightColor,
					highlightSoftness: Math.max(0, Math.min(1, params.highlightSoftness)),
					fresnel: Math.max(0, params.fresnel),
					fresnelSoftness: Math.max(0, Math.min(1, params.fresnelSoftness)),
					fresnelColor: params.fresnelColor,
					tintColor: params.tintColor,
					tintIntensity: Math.max(0, Math.min(1, params.tintIntensity)),
					tintPreserveLuminosity: params.tintPreserveLuminosity ? 1 : 0,
					cutout: params.cutout ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: params.input, sdf: distanceInput }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
