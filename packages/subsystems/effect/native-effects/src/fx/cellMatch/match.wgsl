@group(0) @binding(1) var<storage, read> statistics: array<CellRegionStatistics>;
@group(0) @binding(2) var<storage, read_write> assignments: array<u32>;

fn invocationIndex(invocation: vec3u, workgroups: vec3u) -> u32 {
	return invocation.x + invocation.y * workgroups.x * 64u;
}

@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) workgroups: vec3u) {
	let index = invocationIndex(invocation, workgroups);
	if (index >= uniforms.cellCount) { return; }
	assignments[index] = index;
}

fn appearanceError(inputColor: vec4f, referenceColor: vec4f) -> f32 {
	var inputRgb = vec3f(0.0);
	var referenceRgb = vec3f(0.0);
	// 透明部分を黒として平均しない。両者に可視部分があるときだけ代表色を比較し、
	// 透明度の不足は別の誤差にし、透明なセル同士で意味のない色差を評価しない。
	if (inputColor.a > 0.0) { inputRgb = inputColor.rgb / inputColor.a; }
	if (referenceColor.a > 0.0) { referenceRgb = referenceColor.rgb / referenceColor.a; }
	let difference = inputRgb - referenceRgb;
	var colorError = dot(difference, difference) / 3.0;
	if (uniforms.matchBy == 1u) {
		let luminanceDifference = dot(difference, vec3f(0.2126, 0.7152, 0.0722));
		colorError = luminanceDifference * luminanceDifference;
	}
	let visibility = clamp(min(inputColor.a, referenceColor.a), 0.0, 1.0);
	let alphaDifference = inputColor.a - referenceColor.a;
	return visibility * colorError + alphaDifference * alphaDifference;
}

fn assignmentError(source: u32, destination: u32) -> f32 {
	let regionCount = uniforms.regionGridSize * uniforms.regionGridSize;
	let sourceOffset = cellRegionOffset(source, 0u);
	let destinationOffset = cellRegionOffset(destination, 0u);
	var appearanceErrorSum = 0.0;
	for (var regionIndex = 0u; regionIndex < regionCount; regionIndex++) {
		appearanceErrorSum += appearanceError(statistics[sourceOffset + regionIndex].inputColor, statistics[destinationOffset + regionIndex].referenceColor);
	}
	// 等面積の領域を同じ重みで比較する。領域数で正規化し、構造の細かさを変えても
	// 色・透明度に対するPosition Biasの相対的な強さが変わらないようにする。
	// 長辺全体=1の共通単位で距離を測り、解像度や縦横比で移動の重みを変えない。
	let displacement = (vec2f(cellCoordinates(source)) - vec2f(cellCoordinates(destination)))
		* uniforms.cellSize * uniforms.resolution / max(uniforms.resolution.x, uniforms.resolution.y);
	return appearanceErrorSum / f32(regionCount) + uniforms.positionBias * dot(displacement, displacement);
}

var<workgroup> candidateErrors: array<f32, 64>;
var<workgroup> candidateSources: array<u32, 64>;

fn prefersCandidate(error: f32, source: u32, bestError: f32, bestSource: u32, destination: u32) -> bool {
	if (error < bestError) { return true; }
	if (error != bestError) { return false; }
	// 同点では元位置を優先し、それ以外は上から下・左から右のセル番号で決める。
	// 並列の集約順や実行順が変わっても同じ参照元を選ぶため、比較順序を全体で揃える。
	if (source == destination) { return bestSource != destination; }
	return bestSource != destination && source < bestSource;
}

@compute @workgroup_size(64)
fn matchWithReuse(
	@builtin(workgroup_id) workgroup: vec3u,
	@builtin(num_workgroups) workgroups: vec3u,
	@builtin(local_invocation_index) lane: u32,
) {
	// 配置先ごとに一つのworkgroupを使い、全候補を64laneへ分担する。
	// 割当bufferは他の配置先から読まないため、同じ画像片を何度選んでも競合しない。
	let destination = workgroup.x + workgroup.y * workgroups.x;
	if (destination >= uniforms.cellCount) { return; }
	var bestSource = destination;
	var bestError = assignmentError(destination, destination);
	for (var source = lane; source < uniforms.cellCount; source += 64u) {
		let error = assignmentError(source, destination);
		if (prefersCandidate(error, source, bestError, bestSource, destination)) {
			bestSource = source;
			bestError = error;
		}
	}
	candidateErrors[lane] = bestError;
	candidateSources[lane] = bestSource;
	workgroupBarrier();
	for (var stride = 32u; stride > 0u; stride /= 2u) {
		if (lane < stride) {
			let error = candidateErrors[lane + stride];
			let source = candidateSources[lane + stride];
			if (prefersCandidate(error, source, candidateErrors[lane], candidateSources[lane], destination)) {
				candidateErrors[lane] = error;
				candidateSources[lane] = source;
			}
		}
		// 集約先のlaneは次の段で別laneの結果を読むため、全laneで同期する。
		workgroupBarrier();
	}
	if (lane == 0u) { assignments[destination] = candidateSources[0]; }
}

@compute @workgroup_size(64)
fn improve(@builtin(global_invocation_id) invocation: vec3u, @builtin(num_workgroups) workgroups: vec3u) {
	let pairIndex = invocationIndex(invocation, workgroups);
	if (pairIndex >= uniforms.participantCount / 2u) { return; }
	// 総当たり戦の円環法。一つを固定し、残りの奇数個を回転させると、各roundで
	// 各セルが高々一つのペアにだけ現れる。従って異なるworkgroupから同じ割当を
	// 読み書きする競合がなく、その場で交換しても一対一対応を維持できる。
	let ringSize = uniforms.participantCount - 1u;
	var first = uniforms.matchRound;
	var second = ringSize;
	if (pairIndex > 0u) {
		first = (uniforms.matchRound + pairIndex) % ringSize;
		second = (uniforms.matchRound + ringSize - pairIndex) % ringSize;
	}
	// 2冪へ切り上げた余りはダミーの参加者で、実セルと組になっても交換しない。
	if (first >= uniforms.cellCount || second >= uniforms.cellCount) { return; }
	let firstSource = assignments[first];
	let secondSource = assignments[second];
	let currentError = assignmentError(firstSource, first) + assignmentError(secondSource, second);
	let exchangedError = assignmentError(secondSource, first) + assignmentError(firstSource, second);
	// 同点では変更しない。同じ入力や一様な参照で不要なシャッフルを起こさず、
	// NaNなどで比較できない誤差を、交換すべき候補として扱うことも避ける。
	if (exchangedError < currentError) {
		assignments[first] = secondSource;
		assignments[second] = firstSource;
	}
}
