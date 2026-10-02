struct Uniforms {
	aspectRatio: f32,
	strength: f32,
	normalize: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// fit/wrap後の補間関数を解析的に微分する。共通関数でY反転も処理済み。
	// uniformとnearestは勾配0。1x1テクスチャでもtransparentの境界には勾配がある。
	let derivative = readGradient_input(position, true).yz;
	// 各軸[-1,+1]の偏微分を、高さ2・幅2*aspectRatioの等方的な座標へ変換する。
	// 正規化の前に距離の単位を揃え、長方形の出力でも方向が歪まないようにする。
	var gradient = derivative / vec2f(uniforms.aspectRatio, 1.0);
	// 一定値の領域は正規化してもゼロのままにする。
	let magnitude = length(gradient);
	if (uniforms.normalize != 0u && magnitude > 0.0) {
		gradient /= magnitude;
	}
	// Vector Displacementの各軸[-1,+1]の変位座標に戻す。
	// 上の補正は微分する距離、こちらは出力する変位の単位変換なので両方必要。
	return gradient * uniforms.strength / vec2f(uniforms.aspectRatio, 1.0);
}
