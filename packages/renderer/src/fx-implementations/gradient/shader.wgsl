struct Uniforms {
	aspectRatio: f32,
	startPosition: f32,
	endPosition: f32,
	startValue: f32,
	endValue: f32,
	angle: f32,
	interpolation: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) f32 {
	let direction = vec2f(cos(uniforms.angle), sin(uniforms.angle));
	let position = fragData.uv * vec2f(uniforms.aspectRatio, 1.0);
	// 角度によらず画像の両端が -1 / +1 になるように射影を正規化する。
	let extent = dot(abs(direction), vec2f(uniforms.aspectRatio, 1.0));
	let projectedPosition = dot(position, direction) / extent;
	let span = uniforms.endPosition - uniforms.startPosition;
	// 開始・終了が同じ位置なら、その位置を境界とするステップにして0除算を避ける。
	var t = step(uniforms.startPosition, projectedPosition);
	if (span != 0.0) {
		t = clamp((projectedPosition - uniforms.startPosition) / span, 0.0, 1.0);
	}
	if (uniforms.interpolation == 1u) {
		t = smoothstep(0.0, 1.0, t);
	} else if (uniforms.interpolation == 2u) {
		// 両端で1階・2階微分が0になる5次補間（6t^5 - 15t^4 + 10t^3）。
		t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
	}
	return mix(uniforms.startValue, uniforms.endValue, t);
}
