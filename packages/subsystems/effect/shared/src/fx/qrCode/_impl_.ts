import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { encodeQrCode, getQrCodeCenterImageLayout } from './qr-code.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';

const SHAPE_CODES = { square: 0, rounded: 1, circle: 2, diamond: 3, diagonalDown: 4, diagonalUp: 5 } as const;

function nonnegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function unitRatio(value: number): number {
	return Math.min(1, nonnegative(value));
}

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, params, reportStatus }) => {
		const { device } = wgpu;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
		] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { darkColor: 'color', lightColor: 'color', finderFrameColor: 'color', finderCenterColor: 'color', centerImage: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			// 中央画像を読む経路は画素ごとの分岐に入る。暗黙の微分に依存させない。
			sampling: 'level0',
		});
		let cellsTexture = device.createTexture({ size: [1, 1], format: 'rg8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });

		function createCellBindGroup() {
			return device.createBindGroup({ layout, entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: cellsTexture.createView() },
			] });
		}

		let cellsBindGroup = createCellBindGroup();
		let encodedKey: string | null = null;
		let codeSize = 0;

		function prepare(parameters: RuntimeEffectParameters<typeof definition.paramDefs>) {
			// 通常の文字描画と違い、空白・改行・大文字小文字はすべて符号化対象のデータ。
			// ここでtrimや正規化をすると、見た目が似ていても読み取る内容が変わってしまう。
			const content = String(parameters.content ?? '');
			const key = JSON.stringify([content, parameters.errorCorrection, parameters.version]);
			if (key === encodedKey) return;
			encodedKey = key;
			// 失敗した入力を前回の内容のまま表示しない。失敗キーも覚え、同じ再試行を毎フレーム行わない。
			codeSize = 0;
			try {
				const qrCode = encodeQrCode(content, parameters.errorCorrection, parameters.version);
				if (qrCode != null) {
					if (cellsTexture.width !== qrCode.size) {
						cellsTexture.destroy();
						cellsTexture = device.createTexture({ size: [qrCode.size, qrCode.size], format: 'rg8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
						cellsBindGroup = createCellBindGroup();
					}
					device.queue.writeTexture({ texture: cellsTexture }, qrCode.cells, { bytesPerRow: qrCode.size * 2 }, [qrCode.size, qrCode.size]);
					codeSize = qrCode.size;
				}
				reportStatus({ type: 'ready' });
			} catch (error) {
				reportStatus({ type: 'error', message: `QR Code: ${error instanceof Error ? error.message : String(error)}` });
			}
		}

		prepare(params);
		return {
			prepare,
			render: ctx => {
				prepare(ctx.params);
				const parameters = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const quietZone = Math.round(nonnegative(parameters.quietZone));
				const outerSize = nonnegative(parameters.size) * getSizeReferenceLength(parameters.sizeReference, output.texture);
				const cellPixels = outerSize / Math.max(1, codeSize + quietZone * 2);
				const centerImage = getQrCodeCenterImageLayout(codeSize, parameters.centerImageEnabled, parameters.centerImageSize, parameters.centerImagePadding);
				uniformValues.set({
					canvasSize: [width, height],
					imageHalfSize: centerImage.imageHalfSize,
					cutoutBounds: centerImage.cutoutBounds,
					codeSize,
					quietZone,
					cellPixels,
					cellScale: unitRatio(parameters.cellScale),
					roundness: unitRatio(parameters.roundness),
					finderFrameRoundness: unitRatio(parameters.finderFrameRoundness),
					finderCenterRoundness: unitRatio(parameters.finderCenterRoundness),
					cellShape: SHAPE_CODES[parameters.cellShape],
					finderFrameShape: SHAPE_CODES[parameters.finderFrameShape],
					finderCenterShape: SHAPE_CODES[parameters.finderCenterShape],
					connected: Number(parameters.cornerMode === 'connected'),
					antiAlias: Number(parameters.antiAlias),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ darkColor: parameters.darkColor, lightColor: parameters.lightColor, finderFrameColor: parameters.finderFrameColor, finderCenterColor: parameters.finderCenterColor, centerImage: parameters.centerImage }, output.texture, {
					// 入力画像のFitは出力画面ではなく、中央画像の矩形を基準にする。
					centerImage: { width: Math.max(1, centerImage.imageHalfSize[0] * 2 * cellPixels), height: Math.max(1, centerImage.imageHalfSize[1] * 2 * cellPixels) },
				});
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, cellsBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
				cellsTexture.destroy();
			},
		};
	},
});
