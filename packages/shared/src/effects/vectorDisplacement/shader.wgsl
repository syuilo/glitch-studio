// 既存のエフェクト計算のUVを、入力参照APIの中央原点・+Yが上の座標へ戻す。
fn inputPosition(uv: vec2f) -> vec2f {
	return (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
}

struct Params {
	amount: f32,
	rotation: f32,
	flipX: f32,
	flipY: f32,
	aspectRatio: f32,
};

@group(0) @binding(0) var<uniform> params: Params;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let coord = vec2f(uv.x, -uv.y) * 0.5 + 0.5;
	let displacement = read_vector(inputPosition(coord));
	// Vector data uses [-1, 1] coordinates: +X right, +Y up, two units across each axis.
	// Flip first, then rotate in aspect-corrected space so screen angles and lengths are preserved.
	let direction = displacement * vec2f(params.flipX * params.aspectRatio, params.flipY);
	let c = cos(params.rotation);
	let s = sin(params.rotation);
	let rotated = vec2f(c * direction.x - s * direction.y, s * direction.x + c * direction.y)
		/ vec2f(params.aspectRatio, 1.0);
	// Convert the vector itself to texture coordinates before backward sampling.
	let offset = rotated * vec2f(0.5, -0.5) * params.amount;
	let color = read_input(inputPosition(coord - offset));
	return color;
}
