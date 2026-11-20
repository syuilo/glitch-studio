@group(0) @binding(1) var illumination: texture_2d<f32>;

struct Outputs {
	@location(0) color: vec4f,
	@location(1) irradiance: f32,
};

@fragment
fn fs(@location(0) position: vec2f) -> Outputs {
	let uv = vec2f(position.x, -position.y) * 0.5 + 0.5;
	let pixel = uv * vec2f(uniforms.gridSize) - 0.5;
	let cell = vec2i(floor(pixel));
	let weight = fract(pixel);
	// textureLoadで双線形補間し、float32-filterableを必須にしない。
	let maximum = vec2i(uniforms.gridSize) - 1;
	let a = textureLoad(illumination, clamp(cell, vec2i(0), maximum), 0).r;
	let b = textureLoad(illumination, clamp(cell + vec2i(1, 0), vec2i(0), maximum), 0).r;
	let c = textureLoad(illumination, clamp(cell + vec2i(0, 1), vec2i(0), maximum), 0).r;
	let d = textureLoad(illumination, clamp(cell + vec2i(1, 1), vec2i(0), maximum), 0).r;
	let value = mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y) * uniforms.lightIntensity;
	let color = vec4f(min(uniforms.lightColor.rgb * uniforms.lightColor.a * value, vec3f(65504.0)), uniforms.lightColor.a);
	return Outputs(color, min(value, uniforms.maximumIrradiance));
}
