struct Uniforms {
	color: vec4f,
	rightColor: vec4f,
	// x: 列数、y: stereo、z: 有効な音声データ
	options: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> columns: array<vec4f>;

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	if (uniforms.options.z < 0.5) { return vec4f(0.0); }
	let count = u32(uniforms.options.x);
	let x = clamp(uv.x * 0.5 + 0.5, 0.0, 1.0);
	let index = min(u32(x * f32(count)), count - 1u);
	let stereo = uniforms.options.y > 0.5;
	var left: f32;
	var right = 0.0;
	let values = columns[index];
	let bottom = -1.0;
	let scale = select(2.0, 1.0, stereo);
	let leftBottom = select(bottom, 0.0, stereo);
	let aa = max(fwidth(uv.y), 0.000001);
	left = (1.0 - smoothstep(leftBottom + values.y * scale - aa, leftBottom + values.y * scale + aa, uv.y))
		* step(leftBottom, uv.y) * select(0.0, 1.0, values.y > 0.0);
	if (stereo) {
		right = (1.0 - smoothstep(bottom + values.w - aa, bottom + values.w + aa, uv.y))
			* step(bottom, uv.y) * select(0.0, 1.0, values.w > 0.0);
	}

	// 色パラメータは未乗算。被覆率と指定アルファをここで一度だけ乗算する。
	let leftAlpha = left * uniforms.color.a;
	let rightAlpha = right * uniforms.rightColor.a;
	let alpha = max(leftAlpha, rightAlpha);
	let color = (uniforms.color.rgb * leftAlpha + uniforms.rightColor.rgb * rightAlpha) / max(leftAlpha + rightAlpha, 0.000001);
	return vec4f(color * alpha, alpha);
}
