import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { timelineTextureSize } from '../timeline-image.ts';
import { createTextFontLoader } from './text-font-loader.ts';
import { layoutText } from './text-layout.ts';
import { measureTextInkBounds } from './text-bounds.ts';
import { getTextShadowMetrics, createTextShadowMaskRenderer } from './text-shadow.ts';
import code from './text-renderer.wgsl?raw';
import type { TimelineImage } from '../timeline-image.ts';
import type { TextRenderValues } from './text-render-values.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

/** 呼び出し元のレイヤーを知らず、評価済みの文字・装飾を指定解像度のpremultiplied RGBAへ描く。 */
export function createTextRenderer(options: { device: GPUDevice; vertex: GPUShaderModule; resolution: Resolution; format: IntermediateTextureFormat }) {
	let output: GPUTexture | null = null;
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

	function updateMask(values: TextRenderValues, width: number, height: number, plan: ReturnType<typeof planSurface>) {
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
		const { x, y, layout } = plan;
		context!.fillStyle = '#ffffff';
		context!.strokeStyle = '#ffffff';
		context!.lineJoin = 'round';
		context!.textAlign = values.align;
		context!.textBaseline = 'alphabetic';
		context!.direction = 'ltr';
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

	function planSurface(values: TextRenderValues) {
		const frame = options.resolution;
		context!.textAlign = values.align;
		context!.textBaseline = 'alphabetic';
		context!.direction = 'ltr';
		const layout = layoutText({
			text: values.text, fontSize: values.size * frame.height,
			outlineWidth: values.outlineWidth, lineHeight: values.lineHeight, alignment: values.align,
			overflow: values.overflow, maxWidth: values.maxWidth * frame.width }, (line, size) => {
			context!.font = `${size}px ${font.family}`;
			return context!.measureText(line);
		});
		if (layout) context!.font = `${layout.fontSize}px ${font.family}`;
		const ink = layout && measureTextInkBounds(layout, line => context!.measureText(line));
		const positionX = (values.position[0] + 1) * frame.width / 2;
		const positionY = (1 - values.position[1]) * frame.height / 2;
		let pixels = { left: 0, top: 0, right: 1, bottom: 1 };
		const valid = ink && Number.isFinite(positionX) && Number.isFinite(positionY);
		if (valid) {
			pixels = { left: ink.left + positionX, top: ink.top + positionY, right: ink.right + positionX, bottom: ink.bottom + positionY };
			const shadow = values.shadowEnabled && getTextShadowMetrics({ blur: values.shadowBlur, offset: values.shadowOffset }, layout!.fontSize);
			if (shadow) pixels = {
				left: Math.min(pixels.left, pixels.left + shadow.offsetX - shadow.padding),
				right: Math.max(pixels.right, pixels.right + shadow.offsetX + shadow.padding),
				top: Math.min(pixels.top, pixels.top + shadow.offsetY - shadow.padding),
				bottom: Math.max(pixels.bottom, pixels.bottom + shadow.offsetY + shadow.padding),
			};
		}
		// 補間とアンチエイリアスの余白を取り、整数画素へ外向きに丸める。
		pixels = { left: Math.floor(pixels.left) - 2, top: Math.floor(pixels.top) - 2, right: Math.ceil(pixels.right) + 2, bottom: Math.ceil(pixels.bottom) + 2 };
		const bounds = {
			left: pixels.left * 2 / frame.width - 1, right: pixels.right * 2 / frame.width - 1,
			top: 1 - pixels.top * 2 / frame.height, bottom: 1 - pixels.bottom * 2 / frame.height };
		const size = timelineTextureSize(bounds, frame, options.device.limits.maxTextureDimension2D);
		const density = Math.min(size.width / (pixels.right - pixels.left), size.height / (pixels.bottom - pixels.top));
		// 丸めによる微小な縦横比差を座標範囲へ戻す。字形自体を歪ませない。
		bounds.right = bounds.left + size.width / density * 2 / frame.width;
		bounds.bottom = bounds.top - size.height / density * 2 / frame.height;
		return {
			bounds, size, x: valid ? (positionX - pixels.left) * density : 0, y: valid ? (positionY - pixels.top) * density : 0,
			layout: valid && layout ? {
				...layout, fontSize: layout.fontSize * density, outlineWidth: layout.outlineWidth * density,
				lineAdvance: layout.lineAdvance * density, firstBaselineOffset: layout.firstBaselineOffset * density } : null };
	}

	let outputKey: string | null = null;
	let result: TimelineImage;
	return {
		prepare: (blob: Blob | null, signal: AbortSignal) => font.prepare(blob, signal),
		render(encoder: GPUCommandEncoder, values: TextRenderValues): TimelineImage {
			const key = JSON.stringify([font.cacheVersion, values]);
			if (key === outputKey) return result;
			const plan = planSurface(values);
			if (!output || output.width !== plan.size.width || output.height !== plan.size.height) {
				output?.destroy();
				output = options.device.createTexture({ size: plan.size, format: options.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			}
			updateMask(values, output.width, output.height, plan);
			const current = pipeline.update({
				color: constantShaderInput('color', values.color),
				outlineColor: constantShaderInput('color', values.outlineColor), shadowColor: constantShaderInput('color', values.shadowColor) }, output);
			const pass = encoder.beginRenderPass({
				colorAttachments: [{
					view: output.createView(),
					clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(current.pipeline);
			pass.setBindGroup(0, maskBinding);
			pass.setBindGroup(pipeline.inputGroup, current.bindGroup);
			pass.draw(6);
			pass.end();
			outputKey = key;
			return result = { kind: 'texture', texture: output, region: { bounds: plan.bounds, frameSize: options.resolution } };
		},
		dispose() {
			font.dispose();
			pipeline.dispose();
			maskTexture?.destroy();
			shadowRenderer?.dispose();
			output?.destroy();
			canvas.width = 1;
			canvas.height = 1;
		},
	};
}
