struct Uniforms {
	amount: u32,
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
	let projectionSize = abs(normal.x) + abs(normal.y);
	let bandPosition = dot(fragData.uv, normal) / projectionSize;
	var shift = 0.0;

	for (var i = 0u; i < uniforms.amount; i++) {
		let tearing = uniforms.shifts[i];
		if (bandPosition > tearing.x - tearing.z && bandPosition < tearing.x + tearing.z) {
			shift += tearing.y;
		}
	}

	let offset = direction * shift;
	let center = read_input(fragData.uv + offset);
	let red = read_input(fragData.uv + offset * (1.0 + uniforms.channelShift)).r;
	let blue = read_input(fragData.uv + offset * (1.0 + uniforms.channelShift / 2.0)).b;
	// 入力は既にpremultiplied alphaなので、alphaを再乗算しない。
	return vec4f(red, center.g, blue, center.a);
}
