struct Uniforms {
	color: vec4f,
	rightColor: vec4f,
	// x: 列数、y: stereo、z: spectrum、w: 線幅（出力高さに対する比率）
	options: vec4f,
	// x: 出力アスペクト比、y: 有効な音声データ
	dimensions: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> columns: array<vec4f>;

fn segmentDistance(point: vec2f, a: vec2f, b: vec2f) -> f32 {
	let ab = b - a;
	let t = clamp(dot(point - a, ab) / max(dot(ab, ab), 0.000000000001), 0.0, 1.0);
	return length(point - (a + ab * t));
}

fn waveformCoverage(point: vec2f, index: u32, right: bool, center: f32, scale: f32) -> f32 {
	let count = u32(uniforms.options.x);
	let aspect = uniforms.dimensions.x;
	let position = vec2f(point.x * aspect, point.y);
	var distance = 100000.0;
	// 前後の列まで線分でつなぎ、急な立ち上がりも途切れさせない。
	for (var offset = -1; offset <= 1; offset++) {
		let i = u32(clamp(i32(index) + offset, 0, i32(count) - 1));
		let next = min(i + 1u, count - 1u);
		let column = columns[i];
		let nextColumn = columns[next];
		let span = select(column.xy, column.zw, right) * scale + center;
		let nextSpan = select(nextColumn.xy, nextColumn.zw, right) * scale + center;
		let x = ((f32(i) + 0.5) / f32(count) * 2.0 - 1.0) * aspect;
		let nextX = ((f32(next) + 0.5) / f32(count) * 2.0 - 1.0) * aspect;
		distance = min(distance, segmentDistance(position, vec2f(x, span.x), vec2f(x, span.y)));
		distance = min(distance, segmentDistance(position, vec2f(x, (span.x + span.y) * 0.5), vec2f(nextX, (nextSpan.x + nextSpan.y) * 0.5)));
	}
	let radius = uniforms.options.w;
	let aa = max(fwidth(point.y), 0.000001);
	return 1.0 - smoothstep(max(0.0, radius - aa), radius + aa, distance);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	if (uniforms.dimensions.y < 0.5) { return vec4f(0.0); }
	let count = u32(uniforms.options.x);
	let x = clamp(uv.x * 0.5 + 0.5, 0.0, 1.0);
	let index = min(u32(x * f32(count)), count - 1u);
	let stereo = uniforms.options.y > 0.5;
	let spectrum = uniforms.options.z > 0.5;
	var left: f32;
	var right = 0.0;
	if (spectrum) {
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
	} else {
		let scale = select(1.0, 0.45, stereo);
		left = waveformCoverage(uv, index, false, select(0.0, 0.5, stereo), scale);
		if (stereo) { right = waveformCoverage(uv, index, true, -0.5, scale); }
	}
	let alpha = max(left, right);
	let color = (uniforms.color.rgb * left + uniforms.rightColor.rgb * right) / max(left + right, 0.000001);
	return vec4f(color, alpha);
}
