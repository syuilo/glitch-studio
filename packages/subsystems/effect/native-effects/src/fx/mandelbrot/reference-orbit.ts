import { packMandelbrotFixedPoint, writeMandelbrotReal } from './extended-precision.ts';
import type { MandelbrotReferenceRequest } from './mandelbrot-settings.ts';

export type MandelbrotReferenceOrbit = {
	/** WGSLのReferenceSample（48 bytes）を並べたstorage bufferの内容。 */
	data: ArrayBuffer;
	center: readonly [number, number];
};

// 基準軌道だけに使う二進固定小数点。BigIntならGPU・外部ライブラリの丸め方に依存せず、
// 十進文字列を一度numberへ変換して中心座標の桁を失うこともない。
function decimalToFixedPoint(text: string, precisionBits: number): bigint {
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text.trim());
	if (match == null) throw new Error(`Invalid Mandelbrot reference coordinate: ${text}`);
	const fraction = match[3] ?? match[4] ?? '';
	const digits = (match[2] ?? '') + fraction;
	const exponent = Number(match[5] ?? 0) - fraction.length;
	if (digits.length > 4096 || !Number.isSafeInteger(exponent) || Math.abs(exponent) > 4096) {
		throw new Error('Mandelbrot reference coordinates support at most 4096 decimal digits and exponent magnitude 4096.');
	}
	let numerator = BigInt(digits) << BigInt(precisionBits);
	let denominator = 1n;
	if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
	else denominator = 10n ** BigInt(-exponent);
	const magnitude = (numerator + denominator / 2n) / denominator;
	return match[1] === '-' ? -magnitude : magnitude;
}

function bitLength(value: bigint): number {
	return value === 0n ? 0 : (value < 0n ? -value : value).toString(2).length;
}

function scaledMantissa(value: bigint, magnitudeBits: number): number {
	const magnitude = value < 0n ? -value : value;
	const shift = Math.max(0, magnitudeBits - 53);
	const mantissa = Number(magnitude >> BigInt(shift)) * 2 ** (shift - magnitudeBits);
	return value < 0n ? -mantissa : mantissa;
}

function roundedShift(value: bigint, precisionBits: bigint, rounding: bigint): bigint {
	return value < 0n ? -((-value + rounding) >> precisionBits) : (value + rounding) >> precisionBits;
}

export async function buildMandelbrotReferenceOrbit(request: MandelbrotReferenceRequest, signal: AbortSignal): Promise<MandelbrotReferenceOrbit> {
	signal.throwIfAborted();
	const precisionBits = BigInt(request.precisionBits);
	const real = decimalToFixedPoint(request.center[0], request.precisionBits) + decimalToFixedPoint(request.centerOffset[0].toString(), request.precisionBits);
	const imaginary = decimalToFixedPoint(request.center[1], request.precisionBits) + decimalToFixedPoint(request.centerOffset[1].toString(), request.precisionBits);
	const centerBits = Math.max(bitLength(real), bitLength(imaginary));
	const centerExponent = centerBits - request.precisionBits;
	const center: [number, number] = centerBits === 0 ? [0, 0] : [scaledMantissa(real, centerBits) * 2 ** centerExponent, scaledMantissa(imaginary, centerBits) * 2 ** centerExponent];
	// 広い座標範囲を意味なくBigIntで反復したり、直接描画のuniformへInfinityを渡さない。
	// 集合の周囲に対して十分広く、最後の二乗も既存のf32彩色処理に収まる範囲。
	if (!center.every(value => Number.isFinite(value) && Math.abs(value) <= 1e12)) throw new Error('Mandelbrot center components must be within [-1e12, 1e12].');
	if (!request.usePerturbation) return { center, data: new ArrayBuffer(48) };
	const data = new ArrayBuffer((request.maximumIterations + 1) * 48);
	const integers = new Uint32Array(data);
	const radius = decimalToFixedPoint(request.bailoutRadius.toString(), request.precisionBits);
	const radiusSquared = radius * radius;
	const rounding = 1n << (precisionBits - 1n);
	let zReal = 0n;
	let zImaginary = 0n;
	let count = 0;
	for (let iteration = 0; iteration <= request.maximumIterations; iteration++) {
		const realSquared = zReal * zReal;
		const imaginarySquared = zImaginary * zImaginary;
		const slot = iteration * 12;
		writeMandelbrotReal(integers, slot, packMandelbrotFixedPoint(zReal, request.precisionBits));
		writeMandelbrotReal(integers, slot + 4, packMandelbrotFixedPoint(zImaginary, request.precisionBits));
		// |Z|がBailout Radiusとほぼ等しい場合、GPUでZをf32へ丸めてから比較すると
		// 「Rをわずかに超えた」ことを失う。差を高精度で先に求め、指数を分離して転送する。
		const bailoutMargin = realSquared + imaginarySquared - radiusSquared;
		writeMandelbrotReal(integers, slot + 8, packMandelbrotFixedPoint(bailoutMargin, 2 * request.precisionBits));
		count++;
		if (bailoutMargin > 0n || iteration === request.maximumIterations) break;
		const nextImaginary = roundedShift(2n * zReal * zImaginary, precisionBits, rounding) + imaginary;
		zReal = roundedShift(realSquared - imaginarySquared, precisionBits, rounding) + real;
		zImaginary = nextImaginary;
		// レンダラーワーカーを占有せず、新しいView・中断・破棄を計算途中で受け取れるようにする。
		if ((iteration + 1) % 256 === 0) {
			await new Promise<void>(resolve => setTimeout(resolve, 0));
			signal.throwIfAborted();
		}
	}
	signal.throwIfAborted();
	return { center, data: data.slice(0, count * 48) };
}
