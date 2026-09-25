struct Uniforms {
	aspectRatio: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// パラメータ場は出力先の座標で読む。画像と一緒に逆変換しないことで、
	// 定数なら通常の変形、位置ごとに異なる値なら局所的な歪みとして扱える。
	let translation = read_translation(position);
	let scale = read_scale(position);
	// +Yが上の座標系なので、時計回りの角度は符号を反転する。
	let rotation = -read_rotation(position) * 3.141592653589793;
	// いずれかの軸が潰れた場合は逆変換できないため、透明とする。
	if (any(abs(scale) < vec2f(0.000001))) {
		return vec4f(0.0);
	}

	// Translationの+1は画面幅/高さの半分。ScaleやRotationを変えても
	// 中心位置が動かないよう、入力画像の寸法には依存させない。
	let outputExtent = vec2f(uniforms.aspectRatio, 1.0);
	let translated = (position - translation) * outputExtent;
	let cosine = cos(rotation);
	let sine = sin(rotation);
	// 拡縮→回転→移動の逆変換。回転中だけ縦横の距離の単位を揃え、
	// 長方形の出力でも歪ませず、最後に共通入力の正規化座標へ戻す。
	let rotated = vec2f(cosine * translated.x + sine * translated.y, -sine * translated.x + cosine * translated.y);
	let sourcePosition = rotated / (scale * outputExtent);
	// fit・wrap・filterは共通入力に任せる。uniformは変形後も一定値を返す。
	return read_input(sourcePosition);
}
