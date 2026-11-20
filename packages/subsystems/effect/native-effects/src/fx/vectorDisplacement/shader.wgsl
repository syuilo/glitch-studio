struct Params {
	amount: f32,
	rotation: f32,
	flipX: f32,
	flipY: f32,
	displacementScale: vec2f,
};

@group(0) @binding(0) var<uniform> params: Params;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let displacement = read_vector(position);
	// 入力は長辺全体=1の等方的な変位。反転・回転はこの共通単位で行い、
	// 最後に画像参照座標へ換算して、縦横比にかかわらず同じ角度と長さを保つ。
	let direction = displacement * vec2f(params.flipX, params.flipY);
	let c = cos(params.rotation);
	let s = sin(params.rotation);
	let rotated = vec2f(c * direction.x - s * direction.y, s * direction.x + c * direction.y)
		* params.displacementScale;
	// 変位も入力参照と同じ中央原点・+Yが上の単位なので、そのまま逆向きに辿る。
	return read_input(position - rotated * params.amount);
}
