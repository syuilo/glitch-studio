import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import { createTextFontLoader } from './font-loader.ts';
import { layoutText } from './layout.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, params, reportStatus }) => {
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext('2d');
		if (context == null) throw new Error('Could not create a text canvas.');
		const font = createTextFontLoader(reportStatus);
		const prepare = (nextParams: typeof params) => font.prepare(nextParams.font?.fileData ?? null);
		const maskLayout = wgpu.device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const pipeline = createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { color: 'color', outlineColor: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [maskLayout],
		});
		const sampler = wgpu.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		let maskTexture: GPUTexture | null = null;
		let maskBinding: GPUBindGroup | null = null;
		let maskKey: string | null = null;

		function updateMask(values: typeof params, width: number, height: number) {
			// 式の結果は数値などにもなり得るため、描画とキャッシュには文字列化した値を使う。
			const text = String(values.text);
			// 色のアニメーションや接続先の更新では、Canvas描画と転送を繰り返さない。
			const key = JSON.stringify([font.cacheVersion, width, height, text, values.size, values.outlineWidth, values.position, values.align, values.lineHeight, values.overflow, values.maxWidth]);
			if (maskKey === key) return;
			// layer 0は本体、layer 1は本体と輪郭の和集合。無効時は本体の1層だけを保持する。
			const maskLayerCount = Number.isFinite(values.outlineWidth) && values.outlineWidth > 0 ? 2 : 1;
			if (canvas.width !== width || canvas.height !== height || maskTexture?.depthOrArrayLayers !== maskLayerCount) {
				canvas.width = width;
				canvas.height = height;
				maskTexture?.destroy();
				// Canvas由来の0〜1の被覆率のみ保持する。浮動小数点の計算・履歴テクスチャではない。
				maskTexture = wgpu.device.createTexture({
					size: { width, height, depthOrArrayLayers: maskLayerCount },
					format: 'rgba8unorm',
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				maskBinding = wgpu.device.createBindGroup({ layout: maskLayout, entries: [
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
				for (let layer = 0; layer < maskLayerCount; layer++) {
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
					wgpu.device.queue.copyExternalImageToTexture(
						{ source: canvas },
						{ texture: maskTexture!, origin: { z: layer }, premultipliedAlpha: true },
						{ width, height },
					);
				}
			} finally {
				context!.restore();
			}
			maskKey = key;
		}

		prepare(params);
		return {
			get cacheVersion() { return font.cacheVersion; },
			prepare,
			render: ctx => {
				prepare(ctx.params);
				const output = ctx.outputDataMap.output;
				if (!font.ready) {
					const pass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [{
						view: output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
					}] });
					pass.end();
					return;
				}
				updateMask(ctx.params, output.texture.width, output.texture.height);
				const current = pipeline.update({ color: ctx.params.color, outlineColor: ctx.params.outlineColor }, output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(current.pipeline);
				pass.setBindGroup(0, maskBinding);
				pass.setBindGroup(pipeline.inputGroup, current.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				font.dispose();
				pipeline.dispose();
				maskTexture?.destroy();
				canvas.width = 1;
				canvas.height = 1;
			},
		};
	},
});
