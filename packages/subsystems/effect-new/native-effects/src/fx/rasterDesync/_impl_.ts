import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { ROW_STATE_FLOATS, writeRasterRows } from './raster.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type { RasterSettings } from './raster.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			],
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
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				if (![inputs.rasterDensity.value, inputs.rowWidthError.value, inputs.readOffset.value, inputs.startPosition.value,
										inputs.corruptionProbability.value, inputs.corruptionAmount.value, inputs.restartInterval.value, inputs.seed.value].every(Number.isFinite)
					|| inputs.rasterDensity.value <= 0) {
					throw new Error('Raster desync: parameters must be finite and Raster density must be positive.');
				}
				// 解像度ではなく基準寸法の仮想画素数でラスタを定義する。整数の行幅で折り返すため、
				// アスペクト比から仮想寸法を求めた後にだけ整数化する。
				const referenceSide = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				const columns = Math.max(1, Math.round(resolution.width / referenceSide * inputs.rasterDensity.value));
				const rows = Math.max(1, Math.round(resolution.height / referenceSide * inputs.rasterDensity.value));
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
				seedValue[0] = inputs.seed.value;
				const settings: RasterSettings = {
					columns,
					rows,
					rowWidthError: inputs.rowWidthError.value,
					readOffset: inputs.readOffset.value,
					startPosition: inputs.startPosition.value,
					corruption: inputs.corruption.value,
					corruptionProbability: inputs.corruptionProbability.value,
					corruptionAmount: inputs.corruptionAmount.value,
					resynchronization: inputs.resynchronization.value,
					restartInterval: inputs.restartInterval.value,
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
				pass.setBindGroup(0, rowData.bindGroup);
			},
			disposeResources() {
				rowData?.buffer.destroy();
				uniformBuffer.destroy();
			},
		});
	},
};

export default implementation;
