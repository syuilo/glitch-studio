struct Uniforms {
	resolution: vec2f,
	fitMode: u32,
	samples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// パラメータ場は出力位置で読む。定数なら各ブロックは単色になり、
	// 空間的に変化する場合は局所的に分割・平均化領域が変わる効果として扱う。
	// 1未満の入力は最も粗い分割として扱い、0によるゼロ除算も防ぐ。
	let scale = max(read_scale(position), vec2f(1.0));
	let density = scale * scale;
	var extent = uniforms.resolution;
	if (uniforms.fitMode == 1u) {
		extent = vec2f(max(uniforms.resolution.x, uniforms.resolution.y));
	} else if (uniforms.fitMode == 2u) {
		extent = vec2f(min(uniforms.resolution.x, uniforms.resolution.y));
	}
	// Scale=1で基準領域全体、Scale=3で各軸を9分割する密度になる。
	// 1画素の下限を設けず、基準寸法との比率で解像度に依存しない分割にする。
	let cellSize = 2.0 * (extent / uniforms.resolution) / density;

	// 1 = 180度、正の角度は時計回り。物理的な縦横の単位を揃えてから
	// 逆回転してセルを特定し、サンプル位置は順回転して元画像へ戻す。
	let rotation = -read_rotation(position) * 3.141592653589793;
	let cosine = cos(rotation);
	let sine = sin(rotation);
	let physicalPosition = position * uniforms.resolution;
	let gridPosition = vec2f(
		cosine * physicalPosition.x + sine * physicalPosition.y,
		-sine * physicalPosition.x + cosine * physicalPosition.y,
	) / uniforms.resolution;
	let cellCenter = round(gridPosition / cellSize) * cellSize;
	let physicalCenter = cellCenter * uniforms.resolution;
	let sampleCenter = vec2f(
		cosine * physicalCenter.x - sine * physicalCenter.y,
		sine * physicalCenter.x + cosine * physicalCenter.y,
	) / uniforms.resolution;
	let physicalCellSize = cellSize * uniforms.resolution;
	let horizontalAxis = vec2f(cosine, sine) * physicalCellSize.x / uniforms.resolution;
	let verticalAxis = vec2f(-sine, cosine) * physicalCellSize.y / uniforms.resolution;

	// ブロック内をSamples個の等面積領域へ分割し、それぞれの中心を読む。
	// 平方数以外も正確に指定数を使い、行ごとの列数が違っても面積が偏らないよう
	// 行の高さを列数に比例させる。Samples=1ではブロック中心だけを読む。
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
			let samplePosition = sampleCenter + horizontalAxis * localX + verticalAxis * localY;
			// 同じセルでは同じ位置を参照し、時間や出力画素によるジッターを加えない。
			// 入力のfit/wrap/filterは共通参照関数に任せ、乗算済みRGBAをそのまま平均する。
			result += read_input(samplePosition);
		}
		completedSamples += columns;
	}
	return result / f32(uniforms.samples);
}
