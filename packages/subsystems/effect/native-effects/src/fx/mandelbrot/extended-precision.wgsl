// 摂動にも48bitの仮数を使う。WGSLでは浮動小数点の演算再結合が許されるため、
// TwoSum/TwoProdのf32残差に頼らず、整数の仮数・指数・符号を明示して丸める。
// value = significand * 2^(exponent - 48)、非ゼロの仮数は[2^47, 2^48)。
struct MandelbrotReal {
	significand: vec2u,
	exponent: i32,
	negative: u32,
};

struct MandelbrotComplex {
	real: MandelbrotReal,
	imaginary: MandelbrotReal,
};

fn zeroReal() -> MandelbrotReal { return MandelbrotReal(vec2u(0u), 0, 0u); }
fn zeroComplex() -> MandelbrotComplex { return MandelbrotComplex(zeroReal(), zeroReal()); }
fn isZeroReal(value: MandelbrotReal) -> bool { return all(value.significand == vec2u(0u)); }

fn addUnsigned(first: vec2u, second: vec2u) -> vec2u {
	let low = first.x + second.x;
	return vec2u(low, first.y + second.y + u32(low < first.x));
}

fn subtractUnsigned(first: vec2u, second: vec2u) -> vec2u {
	return vec2u(first.x - second.x, first.y - second.y - u32(first.x < second.x));
}

fn lessUnsigned(first: vec2u, second: vec2u) -> bool {
	return first.y < second.y || (first.y == second.y && first.x < second.x);
}

fn shiftUnsignedRight(value: vec2u, shift: u32) -> vec2u {
	if (shift == 0u) { return value; }
	if (shift >= 64u) { return vec2u(0u); }
	if (shift >= 32u) { return vec2u(value.y >> (shift - 32u), 0u); }
	return vec2u((value.x >> shift) | (value.y << (32u - shift)), value.y >> shift);
}

fn shiftUnsignedLeft(value: vec2u, shift: u32) -> vec2u {
	if (shift == 0u) { return value; }
	if (shift >= 32u) { return vec2u(0u, value.x << (shift - 32u)); }
	return vec2u(value.x << shift, (value.y << shift) | (value.x >> (32u - shift)));
}

fn shiftUnsignedRightJammed(value: vec2u, shift: u32) -> vec2u {
	if (shift == 0u) { return value; }
	if (shift >= 64u) { return vec2u(u32(any(value != vec2u(0u))), 0u); }
	var discarded = false;
	if (shift < 32u) { discarded = (value.x & ((1u << shift) - 1u)) != 0u; }
	else if (shift == 32u) { discarded = value.x != 0u; }
	else { discarded = value.x != 0u || (value.y & ((1u << (shift - 32u)) - 1u)) != 0u; }
	let result = shiftUnsignedRight(value, shift);
	return vec2u(result.x | u32(discarded), result.y);
}

fn normalizeReal(value: vec2u, binaryScale: i32, negative: u32) -> MandelbrotReal {
	if (all(value == vec2u(0u))) { return zeroReal(); }
	let bits = select(firstLeadingBit(value.x) + 1u, firstLeadingBit(value.y) + 33u, value.y != 0u);
	var significand = value;
	var exponent = binaryScale + i32(bits);
	if (bits > 48u) {
		let shift = bits - 48u;
		significand = shiftUnsignedRight(value, shift);
		// この実装が渡す整数は最大64bitなのでshiftは1〜16。最下位の
		// guard・stickyと残す値の偶奇を見て、全GPUで同じties-to-evenに丸める。
		let half = 1u << (shift - 1u);
		let remainder = value.x & ((1u << shift) - 1u);
		if (remainder > half || (remainder == half && (significand.x & 1u) != 0u)) {
			significand = addUnsigned(significand, vec2u(1u, 0u));
		}
		if (significand.y == 0x10000u) { significand = shiftUnsignedRight(significand, 1u); exponent++; }
	} else {
		significand = shiftUnsignedLeft(significand, 48u - bits);
	}
	return MandelbrotReal(significand, exponent, negative);
}

fn addReal(first: MandelbrotReal, second: MandelbrotReal) -> MandelbrotReal {
	if (isZeroReal(first)) { return second; }
	if (isZeroReal(second)) { return first; }
	let exponent = max(first.exponent, second.exponent);
	// 仮数を8bit拡張してから桁を合わせる。大きな相殺が起こる近い指数では
	// 全ビットを保持でき、離れた指数では最終の48bit丸めに余裕を持たせられる。
	let firstAligned = shiftUnsignedRightJammed(shiftUnsignedLeft(first.significand, 8u), u32(exponent - first.exponent));
	let secondAligned = shiftUnsignedRightJammed(shiftUnsignedLeft(second.significand, 8u), u32(exponent - second.exponent));
	if (first.negative == second.negative) { return normalizeReal(addUnsigned(firstAligned, secondAligned), exponent - 56, first.negative); }
	if (lessUnsigned(firstAligned, secondAligned)) { return normalizeReal(subtractUnsigned(secondAligned, firstAligned), exponent - 56, second.negative); }
	return normalizeReal(subtractUnsigned(firstAligned, secondAligned), exponent - 56, first.negative);
}

fn negateReal(value: MandelbrotReal) -> MandelbrotReal {
	return MandelbrotReal(value.significand, value.exponent, value.negative ^ 1u);
}

fn multiplyUnsigned32(first: u32, second: u32) -> vec2u {
	// 16bit同士の積とcarryを順に組み合わせ、u32の積から正確な64bit積を得る。
	let firstLow = first & 0xffffu;
	let secondLow = second & 0xffffu;
	let firstHigh = first >> 16u;
	let secondHigh = second >> 16u;
	let lowProduct = firstLow * secondLow;
	let middle = firstHigh * secondLow + (lowProduct >> 16u);
	let nextMiddle = firstLow * secondHigh + (middle & 0xffffu);
	return vec2u((nextMiddle << 16u) | (lowProduct & 0xffffu), firstHigh * secondHigh + (middle >> 16u) + (nextMiddle >> 16u));
}

fn multiplyReal(first: MandelbrotReal, second: MandelbrotReal) -> MandelbrotReal {
	if (isZeroReal(first) || isZeroReal(second)) { return zeroReal(); }
	let lowProduct = multiplyUnsigned32(first.significand.x, second.significand.x);
	let firstCross = multiplyUnsigned32(first.significand.y, second.significand.x);
	let secondCross = multiplyUnsigned32(first.significand.x, second.significand.y);
	let middle = addUnsigned(addUnsigned(vec2u(lowProduct.y, 0u), firstCross), secondCross);
	let high = middle.y + first.significand.y * second.significand.y;
	// 96bit積の上位64bitを残し、下位32bitはstickyとして保持する。
	// 後段の48bit丸めでは必ず15bit以上落とすので、値の最下位bitに集約してよい。
	let product = vec2u(middle.x | u32(lowProduct.x != 0u), high);
	return normalizeReal(product, first.exponent + second.exponent - 64, first.negative ^ second.negative);
}

fn twiceReal(value: MandelbrotReal) -> MandelbrotReal {
	return MandelbrotReal(value.significand, value.exponent + 1, value.negative);
}

fn realFromFloat(value: f32) -> MandelbrotReal {
	let bits = bitcast<u32>(value);
	let exponent = (bits >> 23u) & 0xffu;
	let significand = (bits & 0x7fffffu) | select(0u, 0x800000u, exponent != 0u);
	return normalizeReal(vec2u(significand, 0u), select(-149, i32(exponent) - 150, exponent != 0u), bits >> 31u);
}

fn realMantissa(value: MandelbrotReal) -> f32 {
	let magnitude = (f32(value.significand.y) * 4294967296.0 + f32(value.significand.x)) * 0.000000000000003552713678800501;
	return select(magnitude, -magnitude, value.negative != 0u);
}

fn realToFloat(value: MandelbrotReal) -> f32 {
	if (value.exponent < -120) { return 0.0; }
	return ldexp(realMantissa(value), value.exponent);
}

fn addComplex(first: MandelbrotComplex, second: MandelbrotComplex) -> MandelbrotComplex {
	return MandelbrotComplex(addReal(first.real, second.real), addReal(first.imaginary, second.imaginary));
}

fn multiplyComplex(first: MandelbrotComplex, second: MandelbrotComplex) -> MandelbrotComplex {
	return MandelbrotComplex(
		addReal(multiplyReal(first.real, second.real), negateReal(multiplyReal(first.imaginary, second.imaginary))),
		addReal(multiplyReal(first.real, second.imaginary), multiplyReal(first.imaginary, second.real)),
	);
}

fn squareComplex(value: MandelbrotComplex) -> MandelbrotComplex {
	return MandelbrotComplex(addReal(multiplyReal(value.real, value.real), negateReal(multiplyReal(value.imaginary, value.imaginary))), twiceReal(multiplyReal(value.real, value.imaginary)));
}

fn complexToFloat(value: MandelbrotComplex) -> vec2f {
	return vec2f(realToFloat(value.real), realToFloat(value.imaginary));
}

fn normalizedComplex(value: MandelbrotComplex) -> vec3f {
	let exponent = max(select(value.real.exponent, -30000, isZeroReal(value.real)), select(value.imaginary.exponent, -30000, isZeroReal(value.imaginary)));
	let real = ldexp(realMantissa(value.real), clamp(value.real.exponent - exponent, -120, 0));
	let imaginary = ldexp(realMantissa(value.imaginary), clamp(value.imaginary.exponent - exponent, -120, 0));
	return vec3f(real, imaginary, f32(exponent));
}

fn hasSmallerMagnitude(first: MandelbrotComplex, second: MandelbrotComplex) -> bool {
	let firstNormalized = normalizedComplex(first);
	let secondNormalized = normalizedComplex(second);
	if (firstNormalized.z < secondNormalized.z - 1.0) { return true; }
	if (firstNormalized.z > secondNormalized.z + 1.0) { return false; }
	return ldexp(dot(firstNormalized.xy, firstNormalized.xy), i32(2.0 * (firstNormalized.z - secondNormalized.z))) < dot(secondNormalized.xy, secondNormalized.xy);
}
