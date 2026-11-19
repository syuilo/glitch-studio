@group(0) @binding(0) var<uniform> halfExtent: vec2f;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec2f {
	// 内部の各軸[-1,+1]を、長辺全体=1の等方的な共通座標へ換算する。
	// 頂点シェーダーの座標は既に+Yが上なので、画像のUVのような反転は不要。
	return position * halfExtent;
}
