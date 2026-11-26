struct Uniforms {
	halfExtent: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// パラメータ場は出力先の座標で読む。画像と一緒に逆変換しないことで、
	// 定数なら通常の変形、位置ごとに異なる値なら局所的な歪みとして扱える。
	let translation = read_translation(position);
	let origin = read_origin(position);
	let scale = read_scale(position);
	// +Yが上の座標系なので、時計回りの角度は符号を反転する。
	let rotation = -read_rotation(position) * 6.283185307179586;
	// いずれかの軸が潰れた場合は逆変換できないため、透明とする。
	if (any(abs(scale) < vec2f(0.000001))) {
		return vec4f(0.0);
	}

	// 共通等方座標で移動を取り消してからOriginを引き、支点からの相対位置にする。
	// 拡縮と回転を取り消した後にOriginを足し戻すと、支点自体はTranslation分だけ移動する。
	let relativePosition = position * uniforms.halfExtent - translation - origin;
	let cosine = cos(rotation);
	let sine = sin(rotation);
	let rotated = vec2f(cosine * relativePosition.x + sine * relativePosition.y, -sine * relativePosition.x + cosine * relativePosition.y);
	let sourcePosition = (rotated / scale + origin) / uniforms.halfExtent;
	// fit・wrap・filterは共通入力に任せる。uniformは変形後も一定値を返す。
	return read_input(sourcePosition);
}
