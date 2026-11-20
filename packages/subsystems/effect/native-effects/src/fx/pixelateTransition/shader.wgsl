struct Uniforms {
	halfExtent: vec2f,
	gridOffset: vec2f,
	maximumCellSize: f32,
	peakPosition: f32,
	mixWidth: f32,
	samples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

fn mixedInput(position: vec2f, weight: f32) -> vec4f {
	if (weight <= 0.0) { return read_inputA(position); }
	if (weight >= 1.0) { return read_inputB(position); }
	return mix(read_inputA(position), read_inputB(position), weight);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	var weight = step(uniforms.peakPosition, progress);
	if (uniforms.mixWidth > 0.0) {
		let mixStart = max(0.0, uniforms.peakPosition - uniforms.mixWidth * 0.5);
		let mixEnd = min(1.0, uniforms.peakPosition + uniforms.mixWidth * 0.5);
		weight = smoothstep(mixStart, mixEnd, progress);
	}
	// 最大セルへ滑らかに成長し、終端までに0へ戻す。
	// 1画素を最小サイズにすると解像度に依存し、端点直前の格子ずれも残るため、
	// サイズは共通距離のまま縮める。極小値のみ数値精度を避けて元位置を読む。
	let envelope = select(progress / uniforms.peakPosition, (1.0 - progress) / (1.0 - uniforms.peakPosition), progress >= uniforms.peakPosition);
	let cellSize = uniforms.maximumCellSize * smoothstep(0.0, 1.0, envelope);
	if (cellSize <= 0.0000001) { return mixedInput(position, weight); }
	let spatialPosition = position * uniforms.halfExtent;
	let cellCenter = floor((spatialPosition - uniforms.gridOffset) / cellSize + 0.5) * cellSize + uniforms.gridOffset;

	// 同じセルは同じ等面積の標本位置を使う。Samplesが平方数でなくても、
	// 列数に比例した行高によって各標本の面積を揃え、明るさの偏りを防ぐ。
	let rowCount = u32(sqrt(f32(uniforms.samples)));
	let baseColumns = uniforms.samples / rowCount;
	let extraRows = uniforms.samples % rowCount;
	var completedSamples = 0u;
	var result = vec4f(0.0);
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(uniforms.samples) - 0.5;
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns) - 0.5;
			let samplePosition = (cellCenter + vec2f(localX, localY) * cellSize) / uniforms.halfExtent;
			// 色は乗算済みRGBAのまま平均し、HDR・負値・半透明を保つ。
			// 入力のFit / Wrap / Filterは共通サンプリングへ任せる。
			result += mixedInput(samplePosition, weight);
		}
		completedSamples += columns;
	}
	return result / f32(uniforms.samples);
}
