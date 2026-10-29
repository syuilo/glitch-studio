struct Uniforms {
	position: vec2f,
	halfSize: vec2f,
	aspectRatio: f32,
	rotation: f32,
	cornerRadius: f32,
	shapeType: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	// 非正の寸法は空形状とする。無限大は後段の減算などでNaNを作るため、
	// 16bit/32bitの両方で表せる有限の最大距離を空形状の値として使う。
	if (any(uniforms.halfSize <= vec2f(0.0))) { return 65504.0; }
	let translated = (position - uniforms.position) * vec2f(uniforms.aspectRatio, 1.0) * 0.5;
	let c = cos(uniforms.rotation);
	let s = sin(uniforms.rotation);
	// 時計回りに回転した形状のローカル座標へ戻す。
	let point = vec2f(c * translated.x - s * translated.y, s * translated.x + c * translated.y);
	if (uniforms.shapeType == 0u) { return ellipseDistance(point, uniforms.halfSize).distance; }
	return rectangleDistance(point, uniforms.halfSize, uniforms.cornerRadius);
}
