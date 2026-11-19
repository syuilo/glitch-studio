import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { drawVerticalTextLine } from '@gs/shared/text/vertical-text.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { loadTextFont } from '../../text-font.ts';
import { layoutText } from './layout.ts';
import { createTextShadowMaskRenderer } from './shadow.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';
import type { NativeParameterValues } from '../../multipass.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, never, typeof definition.staticSettingDefs> = {
	async init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures, resources } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const font = await loadTextFont(resources.font, placement.signal);
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext('2d');
		if (context == null) throw new Error('Could not create a text canvas.');
		const maskLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			],
		});
		const pipeline = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { color: 'color', outlineColor: 'color', shadowColor: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [maskLayout],
		});
		const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		let maskTexture: GPUTexture | null = null;
		let maskBinding: GPUBindGroup | null = null;
		let maskKey: string | null = null;
		let shadowRenderer: ReturnType<typeof createTextShadowMaskRenderer> | null = null;

		function updateMask(values: NativeParameterValues<typeof definition.paramDefs>, width: number, height: number) {
			// 式の結果は数値などにもなり得るため、描画とキャッシュには文字列化した値を使う。
			const text = String(values.text).trim();
			// 色のアニメーションや接続先の更新では、Canvas描画と転送を繰り返さない。
			const key = JSON.stringify([
				width, height, text, values.size, values.sizeReference, values.outlineWidth,
				values.position, values.align, values.lineHeight, values.overflow, values.maxWidth, values.writingMode, values.maxHeight,
				values.shadowEnabled ? [values.shadowBlur, values.shadowOffset] : null,
			]);
			if (maskKey === key) return;
			// layer 0は本体、layer 1は本体と輪郭の和集合、layer 2は影だけのマスク。
			// 影が有効なら輪郭幅0でもlayer 1に本体を入れ、各層の役割を固定する。
			const hasOutline = Number.isFinite(values.outlineWidth) && values.outlineWidth > 0;
			const maskLayerCount = values.shadowEnabled ? 3 : hasOutline ? 2 : 1;
			if (!values.shadowEnabled) {
				shadowRenderer?.dispose();
				shadowRenderer = null;
			}
			if (canvas.width !== width || canvas.height !== height || maskTexture?.depthOrArrayLayers !== maskLayerCount) {
				canvas.width = width;
				canvas.height = height;
				maskTexture?.destroy();
				// Canvas由来の0〜1の被覆率のみ保持する。浮動小数点の計算・履歴テクスチャではない。
				maskTexture = device.createTexture({
					size: { width, height, depthOrArrayLayers: maskLayerCount },
					format: 'rgba8unorm',
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				maskBinding = device.createBindGroup({
					layout: maskLayout,
					entries: [
						{ binding: 0, resource: maskTexture.createView({ dimension: '2d-array' }) },
						{ binding: 1, resource: sampler },
					],
				});
			}
			context!.clearRect(0, 0, width, height);
			const x = width / 2 + values.position[0] * Math.max(width, height);
			const y = height / 2 - values.position[1] * Math.max(width, height);
			let layout: ReturnType<typeof layoutText> = null;
			if ([x, y].every(Number.isFinite)) {
				context!.fillStyle = '#ffffff';
				context!.strokeStyle = '#ffffff';
				// miterの鋭い角が設定幅より遠くへ突き出すことを避け、最大幅の計測と一致させる。
				context!.lineJoin = 'round';
				context!.textAlign = values.align;
				context!.textBaseline = 'alphabetic';
				context!.direction = 'ltr';
				layout = layoutText({
					text,
					writingMode: values.writingMode,
					fontSize: values.size * getSizeReferenceLength(values.sizeReference, { width, height }),
					outlineWidth: values.outlineWidth,
					lineHeight: values.lineHeight,
					alignment: values.align,
					overflow: values.overflow,
					maxInlineSize: values.writingMode === 'vertical-rl' ? values.maxHeight * height : values.maxWidth * width,
				}, (line, size) => {
					context!.font = `${size}px ${font.family}`;
					return context!.measureText(line);
				});
			}
			context!.save();
			try {
				if (layout != null) {
					// 探索の最後に計測したサイズと採用サイズが異なる場合もあるため、明示的に設定する。
					context!.font = `${layout.fontSize}px ${font.family}`;
					// Canvasのstrokeは字形の内外へ半分ずつ広がる。内側はシェーダーで本体を差し引く。
					if (layout.outlineWidth > 0) context!.lineWidth = layout.outlineWidth * 2;
					// Positionを拡縮しないよう、基準点へ移動してから全行を同じ倍率で圧縮する。
					context!.translate(x, y);
					if (layout.verticalLines != null) context!.rotate(Math.PI / 2);
					context!.scale(layout.inlineScale, 1);
				}
				for (let layer = 0; layer < Math.min(maskLayerCount, 2); layer++) {
					if (layout != null) {
						for (let index = 0; index < layout.lines.length; index++) {
							const baseline = layout.firstBaselineOffset + index * layout.lineAdvance;
							if (layout.verticalLines != null) {
								if (layer === 0 || layout.outlineWidth > 0) drawVerticalTextLine(context!, layout.verticalLines[index], layout.fontSize, baseline, layer !== 0);
							} else if (layer === 0) {
								context!.fillText(layout.lines[index], 0, baseline);
							} else if (layout.outlineWidth > 0) {
								context!.strokeText(layout.lines[index], 0, baseline);
							}
						}
					}
					// 転送時点のCanvasが取り込まれるため、同じCanvasへ輪郭を重ねて次の層を作れる。
					// 全行の本体を先に保存することで、別の行の輪郭も文字の内側には残さない。
					device.queue.copyExternalImageToTexture(
						{ source: canvas },
						{ texture: maskTexture!, origin: { z: layer }, premultipliedAlpha: true },
						{ width, height },
					);
				}
			} finally {
				context!.restore();
			}
			if (values.shadowEnabled) {
				// 最大幅・行送りの計算は文字と輪郭だけで完了させ、影は確定した配置から作る。
				if (layout != null) {
					shadowRenderer ??= createTextShadowMaskRenderer();
					shadowRenderer.render(context!, {
						layout,
						fontFamily: font.family,
						alignment: values.align,
						x,
						y,
						settings: { blur: values.shadowBlur, offset: values.shadowOffset },
					});
				} else {
					context!.clearRect(0, 0, width, height);
				}
				device.queue.copyExternalImageToTexture(
					{ source: canvas },
					{ texture: maskTexture!, origin: { z: 2 }, premultipliedAlpha: true },
					{ width, height },
				);
			}
			maskKey = key;
		}

		return {
			cacheKey: 0,
			render: ctx => {
				updateMask(params, outputTexture.width, outputTexture.height);
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				pass.setPipeline(pipeline.pipeline);
				pass.setBindGroup(0, maskBinding);
				pass.setBindGroup(pipeline.inputGroup, pipeline.getBindGroup());
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				font.dispose();
				pipeline.dispose();
				maskTexture?.destroy();
				shadowRenderer?.dispose();
				canvas.width = 1;
				canvas.height = 1;
			},
		};
	},
};

export default implementation;
