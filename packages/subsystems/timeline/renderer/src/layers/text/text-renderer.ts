import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { createTextFontLoader } from './text-font-loader.ts';
import { layoutText } from './text-layout.ts';
import { createTextShadowMaskRenderer } from './text-shadow.ts';
import code from './text-renderer.wgsl?raw';
import type { EvaluatedText } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

/** Textレイヤー専用。評価済みの文字・装飾をScene解像度のpremultiplied RGBAへ描く。 */
export function createTextRenderer(options: { device: GPUDevice; vertex: GPUShaderModule; resolution: Resolution; format: IntermediateTextureFormat }) {
	const output = options.device.createTexture({ size: options.resolution, format: options.format,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
	const canvas = new OffscreenCanvas(1, 1);
	const context = canvas.getContext('2d');
	if (context == null) throw new Error('Could not create a text canvas.');
	const font = createTextFontLoader();
	const maskLayout = options.device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
	] });
	const pipeline = createShaderInputPipeline({
		device: options.device,
		vertex: options.vertex,
		code,
		schema: { color: 'color', outlineColor: 'color', shadowColor: 'color' },
		targets: [{ format: options.format }],
		internalLayouts: [maskLayout],
	});
	const sampler = options.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
	let maskTexture: GPUTexture | null = null;
	let maskBinding: GPUBindGroup | null = null;
	let maskKey: string | null = null;
	let shadowRenderer: ReturnType<typeof createTextShadowMaskRenderer> | null = null;

	function updateMask(values: EvaluatedText, width: number, height: number) {
		const text = values.text;
		// 色のアニメーションでは、Canvas描画と転送を繰り返さない。
		const key = JSON.stringify([
			font.cacheVersion, width, height, text, values.size, values.outlineWidth,
			values.position, values.align, values.lineHeight, values.overflow, values.maxWidth,
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
			maskTexture = options.device.createTexture({
				size: { width, height, depthOrArrayLayers: maskLayerCount },
				format: 'rgba8unorm',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			});
			maskBinding = options.device.createBindGroup({ layout: maskLayout, entries: [
				{ binding: 0, resource: maskTexture.createView({ dimension: '2d-array' }) },
				{ binding: 1, resource: sampler },
			] });
		}
		context!.clearRect(0, 0, width, height);
		const x = (values.position[0] + 1) * width / 2;
		const y = (1 - values.position[1]) * height / 2;
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
				fontSize: values.size * height,
				outlineWidth: values.outlineWidth,
				lineHeight: values.lineHeight,
				alignment: values.align,
				overflow: values.overflow,
				maxWidth: values.maxWidth * width,
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
				context!.scale(layout.horizontalScale, 1);
			}
			for (let layer = 0; layer < Math.min(maskLayerCount, 2); layer++) {
				if (layout != null) {
					for (let index = 0; index < layout.lines.length; index++) {
						const baseline = layout.firstBaselineOffset + index * layout.lineAdvance;
						if (layer === 0) {
							context!.fillText(layout.lines[index], 0, baseline);
						} else if (layout.outlineWidth > 0) {
							context!.strokeText(layout.lines[index], 0, baseline);
						}
					}
				}
				// 転送時点のCanvasが取り込まれるため、同じCanvasへ輪郭を重ねて次の層を作れる。
				// 全行の本体を先に保存することで、別の行の輪郭も文字の内側には残さない。
				options.device.queue.copyExternalImageToTexture(
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
					layout, fontFamily: font.family, alignment: values.align, x, y,
					settings: { blur: values.shadowBlur, offset: values.shadowOffset },
				});
			} else {
				context!.clearRect(0, 0, width, height);
			}
			options.device.queue.copyExternalImageToTexture(
				{ source: canvas },
				{ texture: maskTexture!, origin: { z: 2 }, premultipliedAlpha: true },
				{ width, height },
			);
		}
		maskKey = key;
	}

	let outputKey: string | null = null;
	return {
		prepare: (blob: Blob | null, signal: AbortSignal) => font.prepare(blob, signal),
		render(encoder: GPUCommandEncoder, values: EvaluatedText): GPUTexture {
			const key = JSON.stringify([font.cacheVersion, values]);
			if (key === outputKey) return output;
			updateMask(values, output.width, output.height);
			const current = pipeline.update({ color: constantShaderInput('color', values.color),
				outlineColor: constantShaderInput('color', values.outlineColor), shadowColor: constantShaderInput('color', values.shadowColor) }, output);
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(),
				clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(current.pipeline);
			pass.setBindGroup(0, maskBinding);
			pass.setBindGroup(pipeline.inputGroup, current.bindGroup);
			pass.draw(6);
			pass.end();
			outputKey = key;
			return output;
		},
		dispose() {
			font.dispose();
			pipeline.dispose();
			maskTexture?.destroy();
			shadowRenderer?.dispose();
			output.destroy();
			canvas.width = 1;
			canvas.height = 1;
		},
	};
}
