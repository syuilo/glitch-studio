struct Uniforms {
	halfExtent: vec2f,
	strength: f32,
	normalize: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// fit/wrap後の補間関数を解析的に微分する。共通関数でY反転も処理済み。
	// uniformとnearestは勾配0。1x1テクスチャでもtransparentの境界には勾配がある。
	let derivative = readGradient_input(position, true).yz;
	// 画像参照用の各軸[-1,+1]に対する偏微分を、長辺全体=1の共通単位へ換算する。
	// 正規化の前に距離の単位を揃え、長方形の出力でも方向が歪まないようにする。
	var gradient = derivative / uniforms.halfExtent;
	// 一定値の領域は正規化してもゼロのままにする。
	let magnitude = length(gradient);
	if (uniforms.normalize != 0u && magnitude > 0.0) {
		gradient /= magnitude;
	}
	// 勾配は共通単位のベクトルとしてそのまま後段へ渡す。
	return gradient * uniforms.strength;
}
