struct Uniforms {
	// x: 最新行、y: 有効行数、z: 表示期間（行数）、w: 最新行から現在までの時間（行数）
	timeline: vec4f,
	// x: 横向き、y: 逆方向、z: 周波数反転、w: stereo
	display: vec4f,
	// x: 最小dB、y: 最大dB
	levels: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var history: texture_2d_array<f32>;
@group(0) @binding(2) var historySampler: sampler;

fn heatmap(value: f32) -> vec3f {
	let x = clamp(value, 0.0, 1.0);
	// 黒→青→黄→赤。青と黄の間にシアンを挟み、添付例のように弱い成分も読み分ける。
	if (x < 0.25) { return mix(vec3f(0.0), vec3f(0.0, 0.0, 1.0), x * 4.0); }
	if (x < 0.5) { return mix(vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 1.0), (x - 0.25) * 4.0); }
	if (x < 0.75) { return mix(vec3f(0.0, 1.0, 1.0), vec3f(1.0, 1.0, 0.0), (x - 0.5) * 4.0); }
	return mix(vec3f(1.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), (x - 0.75) * 4.0);
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
	let point = clamp(uv * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
	let horizontal = uniforms.display.x > 0.5;
	// 通常方向では横向きは右、縦向きは上が最新。
	var agePosition = 1.0 - select(point.y, point.x, horizontal);
	if (uniforms.display.y > 0.5) { agePosition = 1.0 - agePosition; }
	var frequency = select(point.x, point.y, horizontal);
	var layer = 0;
	if (uniforms.display.w > 0.5) {
		// 横向き: Lが上、Rが下。縦向き: Lが左、Rが右。
		let half = min(i32(frequency * 2.0), 1);
		layer = select(half, 1 - half, horizontal);
		frequency = clamp(frequency * 2.0 - f32(half), 0.0, 1.0);
	}
	if (uniforms.display.z > 0.5) { frequency = 1.0 - frequency; }
	let dimensions = textureDimensions(history);
	let age = max(0.0, agePosition * uniforms.timeline.z - uniforms.timeline.w);
	let offset = i32(ceil(age));
	if (uniforms.timeline.y < 0.5 || offset >= i32(uniforms.timeline.y)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
	let row = (i32(uniforms.timeline.x) - offset + i32(dimensions.y)) % i32(dimensions.y);
	let bin = frequency * f32(dimensions.x - 1u);
	// 行の中心を指定して時間方向の混合を避け、周波数方向だけ線形補間する。
	let sampleUv = (vec2f(bin, f32(row)) + 0.5) / vec2f(dimensions);
	let amplitude = textureSampleLevel(history, historySampler, sampleUv, layer, 0.0).r;
	let db = 20.0 * log2(max(amplitude, 0.000000000001)) / log2(10.0);
	let value = (db - uniforms.levels.x) / (uniforms.levels.y - uniforms.levels.x);
	return vec4f(heatmap(value), 1.0);
}
