@group(0) @binding(1) var<storage, read> reconstructed: array<ReconstructedSample>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn sample_at(pixel: vec2i) -> ReconstructedSample {
	let point = vec2u(clamp(pixel, vec2i(0), vec2i(ceil(uniforms.virtualSize)) - 1));
	let blockPosition = point / 8u;
	let block = blockPosition.y * uniforms.blockColumns + blockPosition.x;
	// 周波数の係数ではなく、IDCTで復元した空間サンプルを整数位置で読み、後で同じ成分間を補間する。
	return reconstructed[block * 64u + (point.y % 8u) * 8u + point.x % 8u];
}

fn sample_reconstruction(position: vec2f) -> ReconstructedSample {
	let pixel = position * uniforms.virtualSize - 0.5;
	let base = vec2i(floor(pixel));
	let weight = fract(pixel);
	let a = sample_at(base);
	let b = sample_at(base + vec2i(1, 0));
	let c = sample_at(base + vec2i(0, 1));
	let d = sample_at(base + vec2i(1, 1));
	return ReconstructedSample(
		mix(mix(a.base, b.base, weight.x), mix(c.base, d.base, weight.x), weight.y),
		mix(mix(a.difference, b.difference, weight.x), mix(c.difference, d.difference, weight.x), weight.y),
	);
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	// alpha=0のRGBは発光成分を持ち得る。未乗算が必要な処理では、その値を消さずに通す。
	if (original.a <= 0.0) { return original; }
	let reconstruction = sample_reconstruction(fragment.uv * vec2f(0.5, -0.5) + 0.5);
	let originalRgb = original.rgb / original.a;
	var baseRgb = components_to_rgb(reconstruction.base.rgb);
	if (uniforms.preserveDetails != 0u) { baseRgb = originalRgb; }
	// 周波数成分の差は負にもなる。復元後のオーバーシュートや元画像のHDRを保持する。
	let rgb = baseRgb + components_to_rgb(reconstruction.difference.rgb);
	// 入力の透明度と形を保持し、未乗算での加工が終わってから一度だけpremultiplyする。
	return vec4f(rgb * original.a, original.a);
}
