@group(0) @binding(1) var<storage, read> statistics: array<CellStatistics>;
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

fn assignmentError(source: u32, destination: u32) -> f32 {
	let inputColor = statistics[source].inputColor;
	let referenceColor = statistics[destination].referenceColor;
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
	// 長辺全体=1の共通単位で距離を測り、解像度や縦横比で移動の重みを変えない。
	let displacement = (vec2f(cellCoordinates(source)) - vec2f(cellCoordinates(destination)))
		* uniforms.cellSize * uniforms.resolution / max(uniforms.resolution.x, uniforms.resolution.y);
	return visibility * colorError + alphaDifference * alphaDifference + uniforms.positionBias * dot(displacement, displacement);
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
