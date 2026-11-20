export type MandelbrotReal = { significand: [number, number]; exponent: number; negative: number };

// GPUと同じ48bit仮数へ、整数演算でround-to-nearest, ties-to-evenを適用する。
// 各成分は独立した指数を持ち、複素数の片方だけが非常に小さい場合も保持する。
export function packMandelbrotFixedPoint(value: bigint, fractionalBits: number): MandelbrotReal {
	if (value === 0n) return { significand: [0, 0], exponent: 0, negative: 0 };
	const magnitude = value < 0n ? -value : value;
	const bits = magnitude.toString(2).length;
	let exponent = bits - fractionalBits;
	const shift = bits - 48;
	let significand = shift <= 0 ? magnitude << BigInt(-shift) : magnitude >> BigInt(shift);
	if (shift > 0) {
		const remainder = magnitude - (significand << BigInt(shift));
		const half = 1n << BigInt(shift - 1);
		if (remainder > half || (remainder === half && (significand & 1n) !== 0n)) significand++;
	}
	if (significand === 1n << 48n) { significand >>= 1n; exponent++; }
	return { significand: [Number(significand & 0xffffffffn), Number(significand >> 32n)], exponent, negative: value < 0n ? 1 : 0 };
}

export function packMandelbrotNumber(value: number): MandelbrotReal {
	if (!Number.isFinite(value)) throw new Error('Mandelbrot arithmetic input must be finite.');
	const buffer = new ArrayBuffer(8);
	const view = new DataView(buffer);
	view.setFloat64(0, value);
	const bits = view.getBigUint64(0);
	const fraction = bits & ((1n << 52n) - 1n);
	const exponent = Number((bits >> 52n) & 0x7ffn);
	const significand = exponent === 0 ? fraction : fraction | (1n << 52n);
	return packMandelbrotFixedPoint((bits >> 63n) === 0n ? significand : -significand, exponent === 0 ? 1074 : 1075 - exponent);
}

export function writeMandelbrotReal(integers: Uint32Array, offset: number, value: MandelbrotReal): void {
	integers[offset] = value.significand[0];
	integers[offset + 1] = value.significand[1];
	integers[offset + 2] = value.exponent;
	integers[offset + 3] = value.negative;
}
