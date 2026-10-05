struct Uniforms {
	color: vec4f,
	// x: 列数、y: 線幅（出力高さに対する比率）、z: 出力アスペクト比、w: 有効な音声データ
	options: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> columns: array<vec2f>;

fn segmentDistance(point: vec2f, a: vec2f, b: vec2f) -> f32 {
	let ab = b - a;
	let t = clamp(dot(point - a, ab) / max(dot(ab, ab), 0.000000000001), 0.0, 1.0);
	return length(point - (a + ab * t));
}

fn waveformCoverage(point: vec2f, index: u32) -> f32 {
	let count = u32(uniforms.options.x);
	let aspect = uniforms.options.z;
	let position = vec2f(point.x * aspect, point.y);
	let radius = uniforms.options.y;
	let aa = max(fwidth(point.y), 0.000001);
	let columnSpacing = 2.0 * aspect / f32(count);
	// 線幅とアンチエイリアスが届く列まで調べ、太い線の左右が切れないようにする。
	// 隣の列へ伸びる接続線分も対象になるため、さらに1列分を含める。
	let reach = min(count - 1u, u32(ceil((radius + aa) / columnSpacing)) + 1u);
	let first = index - min(index, reach);
	let last = min(index + reach, count - 1u);
	var distance = 100000.0;
	for (var i = first; i <= last; i++) {
		let next = min(i + 1u, count - 1u);
		let span = columns[i];
		let nextSpan = columns[next];
		let x = ((f32(i) + 0.5) / f32(count) * 2.0 - 1.0) * aspect;
		let nextX = ((f32(next) + 0.5) / f32(count) * 2.0 - 1.0) * aspect;
		distance = min(distance, segmentDistance(position, vec2f(x, span.x), vec2f(x, span.y)));
		distance = min(distance, segmentDistance(position, vec2f(x, (span.x + span.y) * 0.5), vec2f(nextX, (nextSpan.x + nextSpan.y) * 0.5)));
	}
	return 1.0 - smoothstep(max(0.0, radius - aa), radius + aa, distance);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	if (uniforms.options.w < 0.5) { return vec4f(0.0); }
	let count = u32(uniforms.options.x);
	let x = clamp(uv.x * 0.5 + 0.5, 0.0, 1.0);
	let index = min(u32(x * f32(count)), count - 1u);
	let alpha = waveformCoverage(uv, index) * uniforms.color.a;
	return vec4f(uniforms.color.rgb * alpha, alpha);
}
