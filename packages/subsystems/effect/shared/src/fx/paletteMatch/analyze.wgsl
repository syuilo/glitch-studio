@group(0) @binding(1) var<storage, read_write> partialStatistics: array<StatisticsPair>;
var<workgroup> samples: array<StatisticsPair, 64>;

fn samplePosition(index: u32) -> vec2f {
	// 任意の解析点数を等面積の区画へ割り振る。画素数に合わせて間引かず、
	// 同じ入力を別解像度で描いても同じ画面上の相対位置を解析する。
	let rows = u32(sqrt(f32(uniforms.sampleCount)));
	let columns = uniforms.sampleCount / rows;
	let extraRows = uniforms.sampleCount % rows;
	let wideSamples = extraRows * (columns + 1u);
	var row: u32;
	var column: u32;
	var rowColumns: u32;
	var completed: u32;
	if (index < wideSamples) {
		row = index / (columns + 1u);
		column = index % (columns + 1u);
		rowColumns = columns + 1u;
		completed = row * rowColumns;
	} else {
		row = extraRows + (index - wideSamples) / columns;
		column = (index - wideSamples) % columns;
		rowColumns = columns;
		completed = wideSamples + (row - extraRows) * columns;
	}
	let uv = vec2f((f32(column) + 0.5) / f32(rowColumns), (f32(completed) + 0.5 * f32(rowColumns)) / f32(uniforms.sampleCount));
	return (uv * 2.0 - 1.0) * vec2f(1.0, -1.0);
}

fn colorSample(color: vec4f, mask: f32) -> ColorStatistics {
	if (!(color.a > 0.0) || !(color.a <= 3.402823e38) || !(mask > 0.0)) { return emptyStatistics(); }
	let lab = toOklab(color.rgb / color.a);
	// 不正な一画素で全体の統計をNaNにしない。有限値でも変換後にoverflowした
	// サンプルは解析から除外し、元画像への適用時にはその画素をそのまま保持する。
	if (!all(abs(lab) <= vec3f(3.402823e38)) || !(mask <= 3.402823e38)) { return emptyStatistics(); }
	let weight = clamp(color.a, 0.0, 1.0) * clamp(mask, 0.0, 1.0);
	return ColorStatistics(vec4f(lab, weight), vec4f(0.0), vec4f(0.0));
}

@compute @workgroup_size(64)
fn analyze(@builtin(global_invocation_id) invocation: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) workgroup: vec3u) {
	var pair = StatisticsPair(emptyStatistics(), emptyStatistics());
	if (invocation.x < uniforms.sampleCount) {
		let position = samplePosition(invocation.x);
		pair = StatisticsPair(colorSample(read_input(position), read_inputAnalysisMask(position)),
			colorSample(read_reference(position), read_referenceAnalysisMask(position)));
	}
	samples[lane] = pair;
	workgroupBarrier();
	for (var stride = 32u; stride > 0u; stride /= 2u) {
		if (lane < stride) { samples[lane] = combinePairs(samples[lane], samples[lane + stride]); }
		workgroupBarrier();
	}
	if (lane == 0u) { partialStatistics[workgroup.x] = samples[0]; }
}
