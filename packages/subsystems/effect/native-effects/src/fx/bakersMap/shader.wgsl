struct Uniforms {
	iterations: u32,
	inverse: u32,
	vertical: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 0回では座標の往復換算も避け、AxisやDirectionにかかわらず通常の入力参照と一致させる。
	if (uniforms.iterations == 0u) {
		return read_input(position);
	}
	// 画像全体の長方形を定義域とする。ここでの[0, 1]は写像内部の各軸の比率であり、
	// 公開する位置・変位の単位ではない。画像参照と同様に+Yを上に保つ。
	var source = position * 0.5 + 0.5;
	if (uniforms.vertical != 0u) {
		// 単なるXY交換は標準写像の逆変換と一致するため、写像全体を反時計回りに90°回す。
		// まず逆回転してX軸の写像へ渡し、後で元の向きへ戻す。
		source = vec2f(source.y, 1.0 - source.x);
	}
	for (var iteration = 0u; iteration < uniforms.iterations; iteration++) {
		if (uniforms.inverse != 0u) {
			// 画像を逆方向へ変換するときは、参照位置を順方向Bで辿る。
			let strip = floor(source.x * 2.0);
			source = vec2f(source.x * 2.0 - strip, (source.y + strip) * 0.5);
		} else {
			// 順方向の画像I'(p) = I(B^-1(p))。左半分を下、右半分を上へ積み直す。
			// 画像を毎回描き直さず座標だけを反復し、途中の補間による劣化を避ける。
			let strip = floor(source.y * 2.0);
			source = vec2f((source.x + strip) * 0.5, source.y * 2.0 - strip);
		}
	}
	if (uniforms.vertical != 0u) {
		source = vec2f(1.0 - source.y, source.x);
	}
	// Fit・Wrap・Filterとpremultiplied alphaは共通入力の規約に従う。
	// 色を再計算しないため、負値や1を超えるHDR値もそのまま保持する。
	return read_input(source * 2.0 - 1.0);
}
