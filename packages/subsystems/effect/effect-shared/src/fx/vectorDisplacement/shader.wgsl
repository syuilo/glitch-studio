struct Params {
	amount: f32,
	rotation: f32,
	flipX: f32,
	flipY: f32,
	aspectRatio: f32,
};

@group(0) @binding(0) var<uniform> params: Params;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let displacement = read_vector(position);
	// Vector data uses [-1, 1] coordinates: +X right, +Y up, two units across each axis.
	// Flip first, then rotate in aspect-corrected space so screen angles and lengths are preserved.
	let direction = displacement * vec2f(params.flipX * params.aspectRatio, params.flipY);
	let c = cos(params.rotation);
	let s = sin(params.rotation);
	let rotated = vec2f(c * direction.x - s * direction.y, s * direction.x + c * direction.y)
		/ vec2f(params.aspectRatio, 1.0);
	// 変位も入力参照と同じ中央原点・+Yが上の単位なので、そのまま逆向きに辿る。
	return read_input(position - rotated * params.amount);
}
