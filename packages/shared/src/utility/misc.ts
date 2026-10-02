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
