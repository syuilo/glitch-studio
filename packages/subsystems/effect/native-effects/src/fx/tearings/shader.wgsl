struct Uniforms {
	amount: u32,
	coordinateScale: vec2f,
	channelShift: f32,
	angle: f32,
	shifts: array<vec4f, 128>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let direction = vec2f(cos(uniforms.angle), sin(uniforms.angle));
	let normal = vec2f(-direction.y, direction.x);
	let projectionSize = dot(abs(normal), uniforms.coordinateScale) * 0.5;
	let bandPosition = dot(fragData.uv * 0.5 * uniforms.coordinateScale, normal);
	var shift = 0.0;

	for (var i = 0u; i < uniforms.amount; i++) {
		let tearing = uniforms.shifts[i];
		if (bandPosition > tearing.x * projectionSize - tearing.z && bandPosition < tearing.x * projectionSize + tearing.z) {
			shift += tearing.y;
		}
	}

	let offset = direction * shift * 2.0 / uniforms.coordinateScale;
	let center = read_input(fragData.uv + offset);
	let red = read_input(fragData.uv + offset * (1.0 + uniforms.channelShift)).r;
	let blue = read_input(fragData.uv + offset * (1.0 + uniforms.channelShift / 2.0)).b;
	// 入力は既にpremultiplied alphaなので、alphaを再乗算しない。
	return vec4f(red, center.g, blue, center.a);
}
