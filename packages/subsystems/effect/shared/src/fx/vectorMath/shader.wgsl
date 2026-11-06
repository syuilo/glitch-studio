// operations.tsのshaderOperationIdに対応する。
override OPERATION: u32 = 0u;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	let a = read_inputA(position);
	let b = read_inputB(position);
	switch OPERATION {
		case 0u: { return a + b; }
		case 1u: { return a - b; }
		case 2u: { return a * b; }
		case 3u: {
			// 片方だけ0除算でも、もう一方の有効な成分は保つ。
			// selectの引数は両方評価されるので、除算そのものの分母も先に保護する。
			let isZero = b == vec2f(0.0);
			let denominator = select(b, vec2f(1.0), isZero);
			return select(a / denominator, vec2f(0.0), isZero);
		}
		case 4u: { return a * read_scale(position); }
		case 5u: { return a * read_scale(position) + b; }
		case 6u: {
			let angle = fract(read_angle(position)) * 6.283185307179586;
			let cosine = cos(angle);
			let sine = sin(angle);
			// +Yが上の共通座標で、既存の角度入力と同じく時計回りを正にする。
			// 座標値の加工なので、画像Transformのような逆変換は行わない。
			return vec2f(cosine * a.x + sine * a.y, -sine * a.x + cosine * a.y);
		}
		case 7u: { return min(a, b); }
		case 8u: { return max(a, b); }
		case 9u: { return abs(a); }
		case 10u: { return floor(a); }
		case 11u: { return fract(a); }
		case 12u: { return sin(fract(a) * 6.283185307179586); }
		case 13u: { return cos(fract(a) * 6.283185307179586); }
		default: { return a; }
	}
}
