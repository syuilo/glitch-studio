struct Uniforms {
	halfExtent: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// パラメータ場は出力先の座標で読む。画像と一緒に逆変換しないことで、
	// 定数なら通常の変形、位置ごとに異なる値なら局所的な歪みとして扱える。
	let translation = read_translation(position);
	let scale = read_scale(position);
	// +Yが上の座標系なので、時計回りの角度は符号を反転する。
	let rotation = -read_rotation(position) * 6.283185307179586;
	// いずれかの軸が潰れた場合は逆変換できないため、透明とする。
	if (any(abs(scale) < vec2f(0.000001))) {
		return vec4f(0.0);
	}

	// 画像参照位置をTranslationと同じ共通等方単位へ換算する。
	// この単位のまま回転し、入力参照の境界でだけ画像参照座標へ戻す。
	let translated = position * uniforms.halfExtent - translation;
	let cosine = cos(rotation);
	let sine = sin(rotation);
	// 拡縮→回転→移動の逆変換。共通等方単位で回転するため、
	// 長方形の出力でも歪ませず、最後に入力の画像参照座標へ戻す。
	let rotated = vec2f(cosine * translated.x + sine * translated.y, -sine * translated.x + cosine * translated.y);
	let sourcePosition = rotated / (scale * uniforms.halfExtent);
	// fit・wrap・filterは共通入力に任せる。uniformは変形後も一定値を返す。
	return read_input(sourcePosition);
}
