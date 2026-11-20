@group(0) @binding(0) var<uniform> uniforms: TextPatternUniforms;
@group(0) @binding(2) var<storage, read_write> instances: array<TextPatternInstance>;
@group(0) @binding(3) var<storage, read> rows: array<TextPatternRow>;
@group(0) @binding(4) var<storage, read_write> trackingOffsets: array<f32>;

@compute @workgroup_size(64)
fn applyTracking(@builtin(global_invocation_id) invocation: vec3u) {
	let rowIndex = invocation.x;
	if (rowIndex >= uniforms.rowCount) { return; }
	let row = rows[rowIndex];
	let end = row.firstCharacter + row.characterCount;
	var totalTracking = 0.0;
	// 行ごとに一つのinvocationが累積和を作り、仕事量を文字数に比例させる。
	// 入力テクスチャの読み取りは先行するdispatchで文字ごとに並列実行済み。
	// 行末には字間がないため、最後の文字の値は行幅に含めない。
	for (var index = row.firstCharacter; index + 1u < end; index++) {
		totalTracking += trackingOffsets[index];
	}
	var accumulatedTracking = 0.0;
	let intervalCount = f32(max(row.characterCount, 2u) - 1u);
	for (var index = row.firstCharacter; index < end; index++) {
		// Distributeでは、各文字までの累積量から「全間隔の合計 × 行内の進行率」を引く。
		// 各間隔から平均値を差し引くことに相当し、先頭と末尾の補正はともに0になる。
		// 一様なTrackingは相殺され、局所的な疎密だけを残す。合計値や変化後の行幅で
		// 除算しないので、Trackingが0・負値になっても同じ式で扱える。
		let progress = f32(index - row.firstCharacter) / intervalCount;
		let correctionFraction = select(uniforms.alignment, progress, uniforms.preserveTrackingEndpoints != 0u);
		instances[index].transform.x += accumulatedTracking - totalTracking * correctionFraction;
		accumulatedTracking += trackingOffsets[index];
	}
}
