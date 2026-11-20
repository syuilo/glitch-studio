import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createFixedInputPipeline, bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { encodeQrCode, getQrCodeCenterImageLayout } from './qr-code.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';
import type { NativeParameterValues } from '../../multipass.ts';

const SHAPE_CODES = { square: 0, rounded: 1, circle: 2, diamond: 3, diagonalDown: 4, diagonalUp: 5 } as const;

function nonnegative(value: number): number {
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function unitRatio(value: number): number {
	return Math.min(1, nonnegative(value));
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
		] });
		const centerImageSize = { ...resolution };
		const pipelines = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { darkColor: 'color', lightColor: 'color', finderFrameColor: 'color', finderCenterColor: 'color', centerImage: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			// 中央画像を読む経路は画素ごとの分岐に入る。暗黙の微分に依存させない。
			sampling: 'level0', samplingOverrides: { referenceResolutions: { centerImage: centerImageSize } },
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

		function prepare(parameters: NativeParameterValues<typeof definition.paramDefs>) {
			// 通常の文字描画と違い、空白・改行・大文字小文字はすべて符号化対象のデータ。
			// ここでtrimや正規化をすると、見た目が似ていても読み取る内容が変わってしまう。
			const content = String(parameters.content ?? '');
			const key = JSON.stringify([content, parameters.errorCorrection, parameters.version]);
			if (key === encodedKey) return;
			const qrCode = encodeQrCode(content, parameters.errorCorrection, parameters.version);
			if (qrCode != null) {
				if (cellsTexture.width !== qrCode.size) {
					cellsTexture.destroy();
					cellsTexture = device.createTexture({ size: [qrCode.size, qrCode.size], format: 'rg8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
					cellsBindGroup = createCellBindGroup();
				}
				device.queue.writeTexture({ texture: cellsTexture }, qrCode.cells, { bytesPerRow: qrCode.size * 2 }, [qrCode.size, qrCode.size]);
			}
			codeSize = qrCode?.size ?? 0;
			encodedKey = key;
		}

		return {
			cacheKey: 0,
			prepare() { prepare(params); },
			render: ctx => {
				const { width, height } = outputTexture;
				const quietZone = Math.round(nonnegative(params.quietZone));
				const outerSize = getSizeReferenceLength(params.sizeReference, outputTexture);
				const cellPixels = outerSize / Math.max(1, codeSize + quietZone * 2);
				const centerImage = getQrCodeCenterImageLayout(codeSize, params.centerImageEnabled, params.centerImageSize, params.centerImagePadding);
				uniformValues.set({
					canvasSize: [width, height],
					imageHalfSize: centerImage.imageHalfSize,
					cutoutBounds: centerImage.cutoutBounds,
					codeSize,
					quietZone,
					cellPixels,
					cellScale: unitRatio(params.cellScale),
					roundness: unitRatio(params.roundness),
					finderFrameRoundness: unitRatio(params.finderFrameRoundness),
					finderCenterRoundness: unitRatio(params.finderCenterRoundness),
					cellShape: SHAPE_CODES[params.cellShape],
					finderFrameShape: SHAPE_CODES[params.finderFrameShape],
					finderCenterShape: SHAPE_CODES[params.finderCenterShape],
					connected: Number(params.cornerMode === 'connected'),
					antiAlias: Number(params.antiAlias),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 中央画像のFitは描画先の矩形を基準にする。出力全体が長方形でも中央画像の比率を保つ。
				centerImageSize.width = Math.max(1, centerImage.imageHalfSize[0] * 2 * cellPixels);
				centerImageSize.height = Math.max(1, centerImage.imageHalfSize[1] * 2 * cellPixels);
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				pass.setPipeline(pipelines.pipeline);
				pass.setBindGroup(0, cellsBindGroup);
				pass.setBindGroup(pipelines.inputGroup, pipelines.getBindGroup());
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
};

export default implementation;
