@group(0) @binding(1) var<storage, read> statistics: array<CellStatistics>;
@group(0) @binding(2) var<storage, read> sortInput: array<SortEntry>;
@group(0) @binding(3) var<storage, read_write> sortOutput: array<SortEntry>;

@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) invocation: vec3u) {
	let line = invocation.x;
	if (line >= uniforms.lines) { return; }
	var segment = 0u;
	for (var index = 0u; index < uniforms.length; index++) {
		let cell = statistics[cellOffset(cellCoordinates(index, line))];
		// 対象外セルに固有の区間を割り当て、前後の対象セルが境界を越えて交換されないようにする。
		if (cell.eligible == 0u) { segment++; }
		sortOutput[line * uniforms.length + index] = SortEntry(segment, cell.key, index);
		if (cell.eligible == 0u) { segment++; }
	}
}

fn comesBefore(left: SortEntry, right: SortEntry) -> bool {
	if (left.segment != right.segment) { return left.segment < right.segment; }
	if (left.key != right.key) {
		return select((left.key < right.key), (left.key > right.key), uniforms.descending != 0u);
	}
	// 同じキーは降順でも元の順序を保持する。書き込み先も一意になり、競合を避けられる。
	return left.sourceIndex < right.sourceIndex;
}

@compute @workgroup_size(64)
fn merge(@builtin(global_invocation_id) invocation: vec3u) {
	let index = invocation.x;
	let line = invocation.y;
	if (index >= uniforms.length) { return; }
	let base = line * uniforms.length;
	let pairStart = index / (2u * uniforms.mergeWidth) * (2u * uniforms.mergeWidth);
	let middle = min(pairStart + uniforms.mergeWidth, uniforms.length);
	let pairEnd = min(pairStart + 2u * uniforms.mergeWidth, uniforms.length);
	let isLeft = index < middle;
	let ownStart = select(middle, pairStart, isLeft);
	let otherStart = select(pairStart, middle, isLeft);
	var lower = otherStart;
	var upper = select(middle, pairEnd, isLeft);
	let entry = sortInput[base + index];
	// 相手側の整列済み区間を二分探索し、自分の順位と足して移動先を求める。
	// RGBAはソートせず元セルの統計に残し、各段階でキーと参照番号だけを転送する。
	while (lower < upper) {
		let candidate = lower + (upper - lower) / 2u;
		if (comesBefore(sortInput[base + candidate], entry)) {
			lower = candidate + 1u;
		} else {
			upper = candidate;
		}
	}
	sortOutput[base + pairStart + (index - ownStart) + (lower - otherStart)] = entry;
}
