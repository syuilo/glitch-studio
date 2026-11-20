struct CellLayout {
	center: vec2f,
	size: vec2f,
};

// 利用側のShaderInput schemaにはdensityMapを含める。セルの描画方法や素材には依存せず、
// 格子座標と共通の密度入力から、各画素が所属する四分木の葉だけを求める。
fn findCellLayout(
	gridPosition: vec2f,
	rootCellSize: vec2f,
	phase: vec2f,
	aspect: vec2f,
	cosine: f32,
	sine: f32,
	maxSubdivisionLevels: u32,
) -> CellLayout {
	let rootIndex = floor(gridPosition / rootCellSize + phase);
	var center = (rootIndex + 0.5 - phase) * rootCellSize;
	var size = rootCellSize;
	for (var level = 0u; level < maxSubdivisionLevels; level++) {
		// 分割の判断は出力画素の位置ではなく候補セルの中心で行う。同じ候補内の
		// 全画素が同じ判断をするため、セルの重複や隙間を作らず、中心と寸法も共通になる。
		// 評価点は個別の移動・拡縮・回転から独立した元の出力座標へ戻す。
		let samplePosition = vec2f(
			cosine * center.x + sine * center.y,
			-sine * center.x + cosine * center.y,
		) * 2.0 / aspect;
		let density = clamp(read_densityMap(samplePosition), 0.0, 1.0);
		let targetLevels = floor(density * f32(maxSubdivisionLevels) + 0.5);
		if (!(targetLevels > f32(level))) { break; }

		// 各軸を半分にした四つの子のうち、描画先を含む一つだけへ進む。
		// 境界上は正側の子へ揃え、時刻や描画履歴に依存する判断を加えない。
		let childDirection = select(vec2f(-0.5), vec2f(0.5), gridPosition >= center);
		size *= 0.5;
		center += childDirection * size;
	}
	return CellLayout(center, size);
}
