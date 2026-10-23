// 値はoperations.tsのshaderOperationIdに対応する。
override OPERATION: u32 = 0u;

fn scalarPower(base: f32, exponent: f32) -> f32 {
	// 0の負乗と、負の底の非整数乗は実数の出力として扱えないため0とする。
	// 0乗は他の底と同じく1とし、0^0の結果も明示する。
	if (base == 0.0) { return select(0.0, 1.0, exponent == 0.0); }
	if (base < 0.0 && fract(exponent) != 0.0) { return 0.0; }
	let magnitude = pow(abs(base), exponent);
	let isOddExponent = fract(abs(exponent) * 0.5) != 0.0;
	return select(magnitude, -magnitude, base < 0.0 && isOddExponent);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let a = read_inputA(position);
	let b = read_inputB(position);
	let c = read_inputC(position);
	switch OPERATION {
		case 0u: { return a + b; }
		case 1u: { return a - b; }
		case 2u: { return a * b; }
		case 3u: {
			if (b == 0.0) { return 0.0; }
			return a / b;
		}
		case 4u: { return min(a, b); }
		case 5u: { return max(a, b); }
		case 6u: { return abs(a); }
		case 7u: { return sign(a); }
		case 8u: { return floor(a); }
		case 9u: { return ceil(a); }
		case 10u: { return round(a); }
		case 11u: { return fract(a); }
		case 12u: {
			if (b == 0.0) { return 0.0; }
			// 剰余の符号は除数に揃える。正のBなら負のAも0〜Bへ折り返せる。
			return a - b * floor(a / b);
		}
		case 13u: { return scalarPower(a, b); }
		case 14u: { return sqrt(max(a, 0.0)); }
		// 角度入力と同じturn単位で読み、三角関数の境界だけラジアンへ変換する。
		case 15u: { return sin(fract(a) * 6.283185307179586); }
		case 16u: { return cos(fract(a) * 6.283185307179586); }
		case 17u: {
			let phase = fract(a);
			// turnなら90度・270度を正確に判定できる。ラジアンへの丸め誤差で
			// 未定義の角度が巨大な有限値になるのを避け、0除算と同じく0を返す。
			if (phase == 0.25 || phase == 0.75) { return 0.0; }
			return tan(phase * 6.283185307179586);
		}
		case 18u: { return step(b, a); }
		case 19u: {
			// WGSLのsmoothstepは同一・逆順の境界では未定義になるため、式を明示する。
			// 同一境界はStepにし、逆順では1から0へ滑らかに変化する。
			if (b == c) { return step(b, a); }
			let amount = clamp((a - b) / (c - b), 0.0, 1.0);
			return amount * amount * (3.0 - 2.0 * amount);
		}
		case 20u: { return select(0.0, 1.0, a > b); }
		case 21u: { return select(0.0, 1.0, a < b); }
		case 22u: { return select(0.0, 1.0, a == b); }
		case 23u: { return clamp(a, min(b, c), max(b, c)); }
		default: { return a; }
	}
}
