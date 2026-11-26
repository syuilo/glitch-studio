import { DEFAULT_BACK_OVERSHOOT_COEFFICIENT, DEFAULT_ELASTIC_PERIOD, EASING_DIRECTIONS, EASING_FAMILIES } from '../easing.ts';
import { deepEqual } from '../utility/deep-equal.ts';
import { deepClone } from '../utility/deep-clone.ts';
import { FUNCTION_CURVE_KINDS } from './function-curve-kinds.ts';
import shaderCode, { structs, uniforms } from './function-curve.shader.ts?shader';
import { createShaderBuffer } from './shader-buffer.ts';
import type { FixedFunctionCurve, FunctionCurve } from '../function-curve/function-curve.ts';

function getFixedFunctionCurveSettings(curve: FixedFunctionCurve) {
	switch (curve.type) {
		case 'easing': {
			let parameter = 0;
			if (curve.family === 'back') parameter = Math.min(curve.overshootCoefficient ?? DEFAULT_BACK_OVERSHOOT_COEFFICIENT, 3.4028234663852886e38);
			// f32で周期とその逆数を有限に表せる範囲へ変換する。
			if (curve.family === 'elastic') parameter = Math.max(1e-37, Math.min(curve.period ?? DEFAULT_ELASTIC_PERIOD, 3.4028234663852886e38));
			return { family: EASING_FAMILIES.indexOf(curve.family), direction: EASING_DIRECTIONS.indexOf(curve.direction), parameter };
		}
		case 'pulse': return { parameter: curve.dutyCycle };
		case 'steps': return { parameter: curve.levelCount };
		case 'deadZone': return { parameter: curve.deadZoneWidth };
		default: return {};
	}
}

/** 1つのFunction Curveをシェーダーに渡すリソースを所有する。 */
export function createFunctionCurveBindings(device: GPUDevice, group: number, visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT) {
	const layout = device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility, buffer: { type: 'uniform' } },
		{ binding: 1, visibility, buffer: { type: 'read-only-storage' } },
	] });
	const settingsData = createShaderBuffer(uniforms.functionCurveSettings);
	const settingsBuffer = device.createBuffer({ size: settingsData.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const pointData = createShaderBuffer(structs.FunctionCurvePoint);
	const pointBytes = new Uint8Array(pointData.arrayBuffer);
	let pointsBuffer = device.createBuffer({ size: pointBytes.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const createBindGroup = () => device.createBindGroup({ layout, entries: [
		{ binding: 0, resource: { buffer: settingsBuffer } },
		{ binding: 1, resource: { buffer: pointsBuffer } },
	] });
	let bindGroup = createBindGroup();
	let previousCurve: FunctionCurve | null = null;
	return {
		layout,
		shaderCode: shaderCode.replaceAll('__FUNCTION_CURVE_GROUP__', String(group)),
		update(curve: FunctionCurve): GPUBindGroup {
			if (deepEqual(curve, previousCurve)) return bindGroup;
			const pointCount = curve.type === 'bezier' ? curve.points.length : 0;
			if (curve.type === 'bezier' && pointCount > 0) {
				const byteLength = pointCount * pointBytes.byteLength;
				if (byteLength > device.limits.maxStorageBufferBindingSize || byteLength > device.limits.maxBufferSize) throw new Error('Function Curve exceeds GPU buffer limits');
				// 点は編集順に保存される。同じXでの順序もCPU評価と一致させ、段差を残す。
				const sortedPoints = curve.points.toSorted((a, b) => a.x - b.x);
				const pointsData = new Uint8Array(byteLength);
				for (const [index, point] of sortedPoints.entries()) {
					pointData.set({ anchor: [point.x, point.y], incoming: point.bezierControlPointA, outgoing: point.bezierControlPointB });
					pointsData.set(pointBytes, index * pointBytes.byteLength);
				}
				if (byteLength > pointsBuffer.size) {
					const replacement = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
					pointsBuffer.destroy();
					pointsBuffer = replacement;
					bindGroup = createBindGroup();
				}
				device.queue.writeBuffer(pointsBuffer, 0, pointsData);
			}
			const fixedSettings = curve.type === 'bezier' ? {} : getFixedFunctionCurveSettings(curve);
			settingsData.set({ kind: FUNCTION_CURVE_KINDS[curve.type], pointCount, ...fixedSettings });
			device.queue.writeBuffer(settingsBuffer, 0, settingsData.arrayBuffer);
			previousCurve = deepClone(curve);
			return bindGroup;
		},
		dispose() {
			settingsBuffer.destroy();
			pointsBuffer.destroy();
		},
	};
}
