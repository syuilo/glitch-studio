@group(0) @binding(1) var<storage, read_write> statistics: array<BlockStatistics>;

override reductionLevel: u32 = 0u;

fn combine_statistics(first: BlockStatistics, second: BlockStatistics) -> BlockStatistics {
	// 子は同じ面積なので等しい重みで統合できる。平均の差による分散も加えることで、
	// 各子が平坦でも子同士で色が異なる領域は、親で分散を持つ。
	let difference = first.mean - second.mean;
	return BlockStatistics(
		(first.mean + second.mean) * 0.5,
		(first.variance + second.variance) * 0.5 + difference * difference * 0.25,
	);
}

@compute @workgroup_size(8, 8)
fn reduce(@builtin(global_invocation_id) invocation: vec3u) {
	let destination = uniforms.levels[reductionLevel];
	if (invocation.x >= destination.y || invocation.y >= destination.z) { return; }
	let source = uniforms.levels[reductionLevel + 1u];
	let index = source.x + invocation.y * 2u * source.y + invocation.x * 2u;
	let top = combine_statistics(statistics[index], statistics[index + 1u]);
	let bottom = combine_statistics(statistics[index + source.y], statistics[index + source.y + 1u]);
	statistics[destination.x + invocation.y * destination.y + invocation.x] = combine_statistics(top, bottom);
}
