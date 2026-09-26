import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import { createTextFontLoader } from './font-loader.ts';
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
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const pipeline = createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { color: 'color' },
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
			const key = JSON.stringify([font.cacheVersion, width, height, text, values.size, values.position, values.align, values.lineHeight]);
			if (maskKey === key) return;
			if (canvas.width !== width || canvas.height !== height || maskTexture == null) {
				canvas.width = width;
				canvas.height = height;
				maskTexture?.destroy();
				// Canvas由来の0〜1の被覆率のみ保持する。浮動小数点の計算・履歴テクスチャではない。
				maskTexture = wgpu.device.createTexture({
					size: { width, height },
					format: 'rgba8unorm',
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				maskBinding = wgpu.device.createBindGroup({ layout: maskLayout, entries: [
					{ binding: 0, resource: maskTexture.createView() },
					{ binding: 1, resource: sampler },
				] });
			}
			context!.clearRect(0, 0, width, height);
			const size = values.size * height;
			const lineAdvance = Math.max(0, values.lineHeight) * size;
			const x = (values.position[0] + 1) * width / 2;
			const y = (1 - values.position[1]) * height / 2;
			// Canvasは無効なfont代入を無視するため、0や非有限値で以前の文字サイズを再利用させない。
			if (size > 0 && [size, lineAdvance, x, y].every(Number.isFinite)) {
				context!.font = `${size}px ${font.family}`;
				context!.fillStyle = '#ffffff';
				context!.textAlign = values.align;
				context!.textBaseline = 'alphabetic';
				context!.direction = 'ltr';
				const lines = text.replace(/\r\n?/g, '\n').split('\n');
				let ascent = 0;
				let descent = 0;
				for (const line of lines) {
					const metrics = context!.measureText(line || 'Mg');
					ascent = Math.max(ascent, metrics.fontBoundingBoxAscent);
					descent = Math.max(descent, metrics.fontBoundingBoxDescent);
				}
				// 位置Yは複数行全体の中央。空行にも同じ行送りを適用する。
				const firstBaseline = y - (ascent + descent + (lines.length - 1) * lineAdvance) / 2 + ascent;
				for (let index = 0; index < lines.length; index++) {
					context!.fillText(lines[index], x, firstBaseline + index * lineAdvance);
				}
			}
			wgpu.device.queue.copyExternalImageToTexture(
				{ source: canvas },
				{ texture: maskTexture, premultipliedAlpha: true },
				{ width, height },
			);
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
				const current = pipeline.update({ color: ctx.params.color }, output.texture);
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
