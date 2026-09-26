import { rawBezierEasing } from './bezier.ts';
import { deepClone } from './deep-clone.ts';
import type { AutomationGraph } from '../types.ts';
import type { DataType } from '../data-type.ts';
import type { ParameterSettings } from '../parameter.ts';

// 型変更時にも利用するため、完成済みのUIや最上位の初期値は要求しない。
// structの空値には各フィールドのBindingの初期値を使う。
type EmptyValueDefinition =
	| { dataType: Exclude<DataType, { kind: 'struct' }> }
	| { dataType: Extract<DataType, { kind: 'struct' }>; fields: Record<string, ParameterSettings<DataType>> };

export function genEmptyValue(paramDef: EmptyValueDefinition): any {
	switch (paramDef.dataType.kind) {
		case 'scalar': return 0;
		case 'enum': return paramDef.dataType.options[0] ?? '';
		case 'bool': return false;
		case 'string': return '';
		case 'blendMode': return 'normal';
		case 'fitMode': return 'stretch';
		case 'wrapMode': return 'repeatMirrored';
		case 'vector': return [0, 0];
		case 'color': return [0, 0, 0, 1];
		case 'any': case 'assetReference': case 'videoAssetReference': case 'playerReference': return null;
		case 'array': return [];
		case 'struct': {
			if (!('fields' in paramDef)) throw new Error('Struct parameter settings are required');
			return Object.fromEntries(Object.keys(paramDef.dataType.fields).map(key => [key, deepClone(paramDef.fields[key].defaultValue)]));
		}
	}
}

// https://stackoverflow.com/questions/326679/choosing-an-attractive-linear-scale-for-a-graphs-y-axis
// https://github.com/apexcharts/apexcharts.js/blob/master/src/modules/Scales.js
// This routine creates the Y axis values for a graph.
export function niceScale(lowerBound: number, upperBound: number, ticks: number): number[] {
	if (lowerBound === 0 && upperBound === 0) return [0];

	// Calculate Min amd Max graphical labels and graph
	// increments.  The number of ticks defaults to
	// 10 which is the SUGGESTED value.  Any tick value
	// entered is used as a suggested value which is
	// adjusted to be a 'pretty' value.
	//
	// Output will be an array of the Y axis values that
	// encompass the Y values.
	const steps: number[] = [];

	// Determine Range
	const range = upperBound - lowerBound;

	let tiks = ticks + 1;
	// Adjust ticks if needed
	if (tiks < 2) {
		tiks = 2;
	} else if (tiks > 2) {
		tiks -= 2;
	}

	// Get raw step value
	const tempStep = range / tiks;

	// Calculate pretty step value
	const mag = Math.floor(Math.log10(tempStep));
	const magPow = Math.pow(10, mag);
	const magMsd = (parseInt as any)(tempStep / magPow);
	const stepSize = magMsd * magPow;

	// build Y label array.
	// Lower and upper bounds calculations
	const lb = stepSize * Math.floor(lowerBound / stepSize);
	const ub = stepSize * Math.ceil(upperBound / stepSize);
	// Build array
	let val = lb;
	while (1) {
		steps.push(val);
		val += stepSize;
		if (val > ub) {
			break;
		}
	}

	return steps;
}

// 正規化された軸では1を基準にし、表示範囲に1があれば必ず目盛りに含める。
export function niceNormalizedScale(lowerBound: number, upperBound: number, ticks: number): number[] {
	if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound) || !Number.isFinite(ticks) || upperBound < lowerBound) return [];
	if (lowerBound === upperBound) return [lowerBound];
	const targetStep = (upperBound - lowerBound) / Math.max(1, ticks);
	// 1以下の刻みは1/nに限定する。例えば0.3に近い刻みは1/3になり、1を飛ばさない。
	const divisions = Math.max(1, Math.round(1 / targetStep));
	// 大きくズームアウトした場合も目盛りが増えすぎないよう、整数幅に切り替える。
	const stride = Math.max(1, Math.ceil(targetStep));
	const firstIndex = Math.floor((lowerBound - 1) * divisions / stride);
	const lastIndex = Math.ceil((upperBound - 1) * divisions / stride);
	if (!Number.isSafeInteger(firstIndex) || !Number.isSafeInteger(lastIndex)) return [];
	const values: number[] = [];
	// 浮動小数点の加算を繰り返さず、整数インデックスから求めて1を正確に生成する。
	for (let index = firstIndex; index <= lastIndex; index++) {
		values.push((divisions + index * stride) / divisions);
	}
	return values;
}

export function evalAutomationGraphValue(automationGraph: { points: AutomationGraph['points'] }, x: number, wrapMode: 'clamp' | 'repeat' | 'repeatMirrored'): number {
	// 元の配列を変更せずX順に並べる。同じXでは元の順序を保ち、後のポイントを優先する。
	const points = automationGraph.points.toSorted((a, b) => a.x - b.x);
	if (points.length === 0) return 0;
	const first = points[0];
	const last = points[points.length - 1];
	const duration = last.x - first.x;
	// 1点だけの場合や全点が同じXの場合は、周期を作れないので定数として扱う。
	if (duration === 0) return last.y;

	switch (wrapMode) {
		case 'clamp':
			x = Math.max(first.x, Math.min(last.x, x));
			break;
		case 'repeat': {
			// 負のXでも正の周期内へ折り返す。終端は次の周期の先頭になる。
			const offset = (x - first.x) % duration;
			x = first.x + (offset < 0 ? offset + duration : offset);
			break;
		}
		case 'repeatMirrored': {
			const period = duration * 2;
			const offset = (x - first.x) % period;
			const phase = offset < 0 ? offset + period : offset;
			x = first.x + (phase <= duration ? phase : period - phase);
			break;
		}
	}

	const prevPoint = points.findLast(point => point.x <= x);
	const nextPoint = points.find(point => point.x > x);
	if (prevPoint == null) return first.y;
	if (nextPoint == null || prevPoint.x === x) return prevPoint.y;
	return rawBezierEasing(
		prevPoint.x,
		prevPoint.x + prevPoint.bezierControlPointB[0],
		nextPoint.x + nextPoint.bezierControlPointA[0],
		nextPoint.x,
		prevPoint.y,
		prevPoint.y + prevPoint.bezierControlPointB[1],
		nextPoint.y + nextPoint.bezierControlPointA[1],
		nextPoint.y,
		x,
	);
}

export function insertIntermediateNumbers(array: number[]): number[] {
	const result = [] as number[];
	for (let i = 0; i < array.length - 1; i++) {
		result.push(array[i]);
		const diff = (array[i + 1] - array[i]) / 2;
		result.push(array[i] + diff);
	}
	result.push(array[array.length - 1]);
	return result;
}

export function nearlyEqual(a: number, b: number, epsilon = 0.0001): boolean {
	return Math.abs(a - b) < epsilon;
}
