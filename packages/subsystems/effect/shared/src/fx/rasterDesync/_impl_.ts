import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { ROW_STATE_FLOATS, writeRasterRows } from './raster.ts';
import code from './shader.wgsl?raw';
import type { RasterSettings } from './raster.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
		});
		const pipelines = createShaderInputPipeline({
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { input: 'color' },
			targets: [{ format: intermediateTextureFormat }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		const createRows = (rows: number) => {
			const values = new Float32Array(rows * ROW_STATE_FLOATS);
			const buffer = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			try {
				const bindGroup = device.createBindGroup({
					layout,
					entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						{ binding: 1, resource: { buffer } },
					],
				});
				return {
					rows,
					values,
					buffer,
					bindGroup,
				};
			} catch (error) {
				buffer.destroy();
				throw error;
			}
		};
		let rowData: ReturnType<typeof createRows> | null = null;
		let previousSettings: string | null = null;
		const seedValue = new Float64Array(1);
		const seedWords = new Uint32Array(seedValue.buffer);

		return {
			render: ctx => {
				const params = ctx.params;
				if (![params.rasterDensity, params.rowWidthError, params.readOffset, params.startPosition,
										params.corruptionProbability, params.corruptionAmount, params.restartInterval, params.seed].every(Number.isFinite)
					|| params.rasterDensity <= 0) {
					throw new Error('Raster desync: parameters must be finite and Raster density must be positive.');
				}
				// 解像度ではなく基準寸法の仮想画素数でラスタを定義する。整数の行幅で折り返すため、
				// アスペクト比から仮想寸法を求めた後にだけ整数化する。
				const referenceSide = getSizeReferenceLength(params.sizeReference, resolution);
				const columns = Math.max(1, Math.round(resolution.width / referenceSide * params.rasterDensity));
				const rows = Math.max(1, Math.round(resolution.height / referenceSide * params.rasterDensity));
				const rowBytes = rows * ROW_STATE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
				// f32で仮想画素の整数位置を区別できる範囲と、行状態用バッファの上限を守る。
				if (!Number.isSafeInteger(columns) || columns > 16777216 || rows > 16777216 || !Number.isSafeInteger(rowBytes)
					|| rowBytes > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
					throw new Error('Raster desync: virtual raster exceeds GPU resource limits. Reduce Raster density.');
				}
				if (rowData == null || rowData.rows !== rows) {
					const next = createRows(rows);
					rowData?.buffer.destroy();
					rowData = next;
					previousSettings = null;
				}
				seedValue[0] = params.seed;
				const settings: RasterSettings = {
					columns,
					rows,
					rowWidthError: params.rowWidthError,
					readOffset: params.readOffset,
					startPosition: params.startPosition,
					corruption: params.corruption,
					corruptionProbability: params.corruptionProbability,
					corruptionAmount: params.corruptionAmount,
					resynchronization: params.resynchronization,
					restartInterval: params.restartInterval,
					seed: (seedWords[0] ^ seedWords[1]) >>> 0,
				};
				const settingsKey = JSON.stringify(settings);
				if (settingsKey !== previousSettings) {
					writeRasterRows(rowData.values, settings);
					device.queue.writeBuffer(rowData.buffer, 0, rowData.values);
					previousSettings = settingsKey;
				}
				uniformValues.set({ rasterSize: [columns, rows] });
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, rowData.bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				rowData?.buffer.destroy();
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
