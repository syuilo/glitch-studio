struct Uniforms {
	halfExtent: vec2f,
	pixelSize: f32,
	feather: f32,
	angle: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn transitionMask(position: vec2f) -> f32 {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return 0.0; }
	if (progress >= 1.0) { return 1.0; }
	let direction = vec2f(sin(uniforms.angle), cos(uniforms.angle));
	let distance = dot(position * uniforms.halfExtent, direction);
	let extent = dot(uniforms.halfExtent, abs(direction));
	// 1画素を進行軸に射影した幅でAAを行い、斜めの境界でも階段状の輪郭を抑える。
	let width = max(uniforms.feather, uniforms.pixelSize * (abs(direction.x) + abs(direction.y)));
	// Feather全体が描画領域の外へ出るまで動かす。端点だけ強制すると、
	// 大きなFeatherで残った画像が最後のフレームに突然消えてしまう。
	let boundary = mix(-extent - width * 0.5, extent + width * 0.5, progress);
	return 1.0 - smoothstep(-width * 0.5, width * 0.5, distance - boundary);
}

@fragment
fn fsMask(@location(0) position: vec2f) -> @location(0) f32 {
	return transitionMask(position);
}
