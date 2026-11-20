struct Uniforms {
	vectorScale: f32,
	intensityScale: f32,
	frequency: f32,
	phase: f32,
	channelPhase: f32,
	brightness: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let background = read_background(position);
	let weight = clamp(read_intensity(position) * uniforms.intensityScale, 0.0, 1.0);
	let opacity = clamp(read_opacity(position), 0.0, 1.0);
	if (weight <= 0.0 || opacity <= 0.0 || background.a <= 0.0) { return background; }
	let velocity = (-read_vector(position) * uniforms.vectorScale - vec2f(0.002)) * weight;
	let edge = clamp((0.4 - weight) / 1.3, 0.0, 1.0);
	let envelope = edge * edge * (3.0 - 2.0 * edge);
	let amplitude = max(abs(velocity.x), abs(velocity.y)) * envelope * uniforms.brightness;
	if (amplitude <= 0.0) { return background; }
	let phase = (velocity.x + velocity.y) * uniforms.frequency + uniforms.phase;
	let phases = vec3f(phase) + vec3f(0.0, 1.0, 2.0) * uniforms.channelPhase;
	let bands = sin(fract(phases) * 6.283185307179586);
	// 背景の未乗算RGBをsRGBへ移し、加算後にlinearへ戻してalphaを一度だけ掛ける。
	// 負値・HDRは共通の符号対称な伝達関数で保持し、最終表示までclampしない。
	let displayColor = colorLinearToSrgb(background.rgb / background.a);
	let colored = colorSrgbToLinear(displayColor + bands * amplitude * opacity);
	return vec4f(colored * background.a, background.a);
}
