struct Uniforms {
	center: vec2f,
	halfSize: vec2f,
	halfExtent: vec2f,
	rotation: f32,
	feather: f32,
	strength: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentOutput {
	@location(0) color: vec4f,
	@location(1) mask: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> FragmentOutput {
	let translated = position * uniforms.halfExtent - uniforms.center;
	let c = cos(uniforms.rotation);
	let s = sin(uniforms.rotation);
	// 時計回りに配置した楕円のローカル座標へ戻す。
	let point = vec2f(c * translated.x - s * translated.y, s * translated.x + c * translated.y);
	// 非正の寸法は空の保護領域とし、全画素を減光対象にする。
	var distance = 65504.0;
	if (all(uniforms.halfSize > vec2f(0.0))) {
		distance = ellipseDistance(point, uniforms.halfSize).distance;
	}
	// Featherは境界の内外へ半分ずつ広げる。AA幅を加算すると指定寸法が
	// 解像度で変わるため、実距離の画素幅とFeatherの大きい方だけを使う。
	let width = max(uniforms.feather, fwidth(distance));
	var mask = select(0.0, 1.0, distance >= 0.0);
	if (width > 0.0) {
		mask = smoothstep(-width * 0.5, width * 0.5, distance);
	}
	if (any(uniforms.halfSize <= vec2f(0.0))) { mask = 1.0; }
	let input = read_input(position);
	// 入力はpremultiplied alpha。RGBだけを減衰し、alphaの再乗算や
	// 黒の重ね描きを避けて、半透明の輪郭と完全透明な余白を保つ。
	return FragmentOutput(vec4f(input.rgb * (1.0 - uniforms.strength * mask), input.a), mask);
}
