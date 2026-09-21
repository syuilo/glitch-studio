import { rawBezierEasing } from './bezier.ts';
import { deepClone } from './deep-clone.ts';
import type { GsAutomation } from '../types.ts';
import type { EffectOptionSchema, VisualModuleParamDef } from '../effect-definition.ts';

export function genEmptyValue(paramDef: EffectOptionSchema | VisualModuleParamDef): any {
	switch (paramDef.dataType) {
		case 'scalar': return 0;
		case 'enum': return paramDef.options[0]?.value ?? null;
		case 'bool': return false;
		case 'blendMode': return 'normal';
		case 'fitMode': return 'stretch';
		case 'wrapMode': return 'repeatMirrored';
		case 'vector': return [0, 0];
		case 'color': return [0, 0, 0, 1];
		case 'any': case 'assetReference': case 'playerReference': return null;
		case 'array': return [];
		case 'struct': return Object.fromEntries(Object.entries(paramDef.fields).map(([key, def]) => [key, deepClone(def.defaultValue)]));
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

export function evalAutomationValue(automation: GsAutomation, x: number): number {
	x = x % (automation.keyframes.reduce((max, kf) => Math.max(max, kf.x), 0) ?? 0);
	const prevKeyframe = automation.keyframes.filter(k => k.x <= x)
		.sort((a, b) => b.x - a.x)
		.sort((a, b) => automation.keyframes.indexOf(b) - automation.keyframes.indexOf(a))[0]; // 同一フレーム内に複数のキーフレームがある場合は、後のものを選択
	const nextKeyframe = automation.keyframes.find(k => (k.x >= x));
	if (prevKeyframe == null) {
		return 0;
	} else if (nextKeyframe == null) {
		return prevKeyframe.y;
	} else if (prevKeyframe === nextKeyframe) {
		return prevKeyframe.y;
	}
	return rawBezierEasing(
		prevKeyframe.x,
		prevKeyframe.x + prevKeyframe.bezierControlPointB[0],
		nextKeyframe.x + nextKeyframe.bezierControlPointA[0],
		nextKeyframe.x,
		prevKeyframe.y,
		prevKeyframe.y + prevKeyframe.bezierControlPointB[1],
		nextKeyframe.y + nextKeyframe.bezierControlPointA[1],
		nextKeyframe.y,
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
