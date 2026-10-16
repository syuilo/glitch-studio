struct Uniforms {
	red: u32,
	green: u32,
	blue: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	let invertChannels = vec3u(uniforms.red, uniforms.green, uniforms.blue) != vec3u(0u);
	// 未乗算RGBでの(1 - color)にalphaを乗算すると、乗算済みではalpha - colorになる。
	// 除算せずに反転することで、完全に透明な画素もそのまま扱える。
	let color = select(input.rgb, vec3f(input.a) - input.rgb, invertChannels);
	return vec4f(color, input.a);
}
