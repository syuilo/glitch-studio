const float32 = new Float32Array(1);
const uint32 = new Uint32Array(float32.buffer);

export function float32ToFloat16Bits(value: number): number {
	float32[0] = value;
	const bits = uint32[0];

	const sign = (bits >>> 16) & 0x8000;
	const exponent = (bits >>> 23) & 0xff;
	const fraction = bits & 0x7fffff;

	// Infinity / NaN
	if (exponent === 0xff) {
		return sign | (fraction === 0 ? 0x7c00 : 0x7e00);
	}

	const e = exponent - 127;

	if (e > 15) return sign | 0x7c00; // Overflow
	if (e < -25) return sign; // Underflow（符号付きゼロ）

	// 通常値と非正規化数で、切り捨てるビット数が異なる
	const shift = e < -14 ? -e - 1 : 13;
	const significand = e < -14 ? fraction | 0x800000 : fraction;
	const divisor = 2 ** shift;

	let rounded = Math.floor(significand / divisor);
	const remainder = significand % divisor;

	// 最近接・偶数丸め
	if (remainder > divisor / 2 || (remainder === divisor / 2 && (rounded & 1) !== 0)) {
		rounded++;
	}

	const magnitude = e < -14
		? rounded
		: ((e + 15) << 10) + rounded;

	return sign | magnitude;
}
