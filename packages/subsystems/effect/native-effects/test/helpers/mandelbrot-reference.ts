// 実装の二進固定小数点・摂動式を転記せず、十進350桁の直接反復を参照解とする。
// GPUの精度・rebasing・基準軌道の丸めと独立して、各画素の発散時刻を検証する。
const decimalDigits = 350;
const unit = 10n ** BigInt(decimalDigits);

function decimal(text: string): bigint {
	const [significand, exponent = '0'] = text.toLowerCase().split('e');
	const [integer, fraction = ''] = significand.replace(/^[+-]/, '').split('.');
	const digits = BigInt(integer + fraction);
	const shift = decimalDigits + Number(exponent) - fraction.length;
	const value = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
	return significand.startsWith('-') ? -value : value;
}

function toNumber(value: bigint): number {
	return Number(value * 10n ** 40n / unit) / 1e40;
}

export function referenceMandelbrot(parameters: {
	referenceCenter: { real: string; imaginary: string };
	view: { center: readonly [number, number]; zoom: number; rotation: number };
	maximumIterations: number;
	bailoutRadius: number;
}, point: [number, number], coordinateOffset: readonly [number, number] = [0, 0]) {
	const angle = parameters.view.rotation * 2 * Math.PI;
	const x = point[0] + coordinateOffset[0];
	const y = point[1] + coordinateOffset[1];
	const scale = decimal((4 / parameters.view.zoom).toString());
	const real = decimal(parameters.referenceCenter.real) + decimal(parameters.view.center[0].toString()) + decimal((x * Math.cos(angle) - y * Math.sin(angle)).toString()) * scale / unit;
	const imaginary = decimal(parameters.referenceCenter.imaginary) + decimal(parameters.view.center[1].toString()) + decimal((x * Math.sin(angle) + y * Math.cos(angle)).toString()) * scale / unit;
	const radius = decimal(parameters.bailoutRadius.toString());
	let zReal = 0n;
	let zImaginary = 0n;
	let triangleAverage = 0;
	let previousTriangleAverage = 0;
	let triangleCount = 0;
	const constantReal = toNumber(real);
	const constantImaginary = toNumber(imaginary);
	const constantMagnitude = Math.hypot(constantReal, constantImaginary);
	for (let iteration = 1; iteration <= parameters.maximumIterations; iteration++) {
		const squaredReal = (zReal * zReal - zImaginary * zImaginary) / unit;
		const squaredImaginary = 2n * zReal * zImaginary / unit;
		zReal = squaredReal + real;
		zImaginary = squaredImaginary + imaginary;
		const aReal = toNumber(squaredReal);
		const aImaginary = toNumber(squaredImaginary);
		const aMagnitude = Math.hypot(aReal, aImaginary);
		if (aMagnitude > 0 && constantMagnitude > 0) {
			// 大きさが離れている場合だけ漸近値を使い、直接の三角不等式で桁落ちするのを避ける。
			const fraction = Math.max(aMagnitude, constantMagnitude) / Math.min(aMagnitude, constantMagnitude) > 1e10
				? (1 + (aReal * constantReal + aImaginary * constantImaginary) / (aMagnitude * constantMagnitude)) / 2
				: (Math.hypot(aReal + constantReal, aImaginary + constantImaginary) - Math.abs(aMagnitude - constantMagnitude)) / (2 * Math.min(aMagnitude, constantMagnitude));
			previousTriangleAverage = triangleAverage;
			triangleAverage += (fraction - triangleAverage) / ++triangleCount;
		}
		if (zReal * zReal + zImaginary * zImaginary > radius * radius) {
			const log2LogMagnitude = Math.log2(Math.log(Math.hypot(toNumber(zReal), toNumber(zImaginary))));
			if (triangleCount > 1) {
				const amount = Math.max(0, Math.min(1, 1 + Math.log2(Math.log(parameters.bailoutRadius)) - log2LogMagnitude));
				triangleAverage = previousTriangleAverage * (1 - amount) + triangleAverage * amount;
			}
			return { escapeIterations: iteration, smoothIterations: iteration + 1 - log2LogMagnitude, escapedMask: 1, triangleInequalityAverage: triangleAverage };
		}
	}
	return { escapeIterations: 0, smoothIterations: 0, escapedMask: 0, triangleInequalityAverage: 0 };
}
