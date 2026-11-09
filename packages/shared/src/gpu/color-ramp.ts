import { COLOR_RAMP_INTERPOLATIONS, prepareColorRamp } from '../color-ramp.ts';
import shaderCode from './color-ramp.wgsl?raw';
import type { ColorRamp } from '../color-ramp.ts';

/** 指定したshader stageで使う1つのColor Rampのbindingとbufferを所有する。 */
export function createColorRampBindings(device: GPUDevice, group: number, visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT) {
	const layout = device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility, buffer: { type: 'uniform' } },
		{ binding: 1, visibility, buffer: { type: 'read-only-storage' } },
	] });
	const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	let capacity = 48;
	let stops = device.createBuffer({ size: capacity, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const createBindGroup = () => device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: settings } }, { binding: 1, resource: { buffer: stops } }] });
	let bindGroup = createBindGroup();
	let previousRamp: string | null = null;
	return {
		layout,
		shaderCode: shaderCode.replaceAll('__COLOR_RAMP_GROUP__', String(group)),
		update(ramp: ColorRamp): GPUBindGroup {
			const rampKey = JSON.stringify(ramp);
			if (rampKey === previousRamp) return bindGroup;
			const prepared = prepareColorRamp(ramp);
			const required = prepared.stops.length * 48;
			if (required > device.limits.maxStorageBufferBindingSize || required > device.limits.maxBufferSize) throw new Error('Color Ramp exceeds GPU buffer limits');
			if (required > capacity) {
				// stop数の変更ではシェーダーを再コンパイルせず、容量不足のときだけbufferを交換する。
				const replacement = device.createBuffer({ size: required, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				stops.destroy();
				stops = replacement;
				capacity = required;
				bindGroup = createBindGroup();
			}
			// positionは位置・区間の開始色相・終了色相・未使用の16byte、
			// 補間用の色と端点用のlinear RGBはそれぞれvec4fで48byte/stop。
			// 端点とConstantでは変換を往復せず、設定した色をそのまま保つ。
			const values = new Float32Array(required / 4);
			for (const [index, stop] of prepared.stops.entries()) {
				values[index * 12] = stop.position;
				values[index * 12 + 1] = stop.segmentHues?.[0] ?? 0;
				values[index * 12 + 2] = stop.segmentHues?.[1] ?? 0;
				values.set(stop.color, index * 12 + 4);
				values.set(stop.linearColor, index * 12 + 8);
			}
			device.queue.writeBuffer(stops, 0, values);
			device.queue.writeBuffer(settings, 0, new Uint32Array([prepared.stops.length, COLOR_RAMP_INTERPOLATIONS.indexOf(prepared.interpolation), ['srgb', 'linearSrgb', 'oklab', 'oklch'].indexOf(prepared.colorSpace), 0]));
			previousRamp = rampKey;
			return bindGroup;
		},
		dispose() {
			settings.destroy();
			stops.destroy();
		},
	};
}
