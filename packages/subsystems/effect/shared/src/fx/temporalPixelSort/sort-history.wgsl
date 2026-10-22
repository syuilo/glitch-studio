@group(0) @binding(1) var historyFrames: texture_2d_array<f32>;
@group(0) @binding(2) var historySampler: sampler;

const INVALID_SAMPLE: u32 = 0xffffffffu;

fn sample_candidate(position: vec2f, current: vec4f, sampleIndex: u32) -> vec4f {
	if (sampleIndex == 0u) { return current; }
	let historyIndex = sampleIndex - 1u;
	let layer = uniforms.historyLayers[historyIndex / 4u][historyIndex % 4u];
	let uv = position * vec2f(0.5, -0.5) + 0.5;
	return textureSampleLevel(historyFrames, historySampler, uv, i32(layer), 0.0);
}

fn sort_key(color: vec4f) -> f32 {
	if (uniforms.sortKey == 4u) { return color.a; }
	if (color.a <= 0.0) { return 0.0; }
	// 色の比較だけunpremultiplyする。半透明の明るい色を暗い色と誤認しないようにし、
	// 選択後の色には元のpremultiplied RGBAを使って二重乗算を避ける。
	let rgb = color.rgb / color.a;
	switch uniforms.sortKey {
		case 1u: { return rgb.r; }
		case 2u: { return rgb.g; }
		case 3u: { return rgb.b; }
		case 5u: {
			let maximum = max(rgb.r, max(rgb.g, rgb.b));
			let minimum = min(rgb.r, min(rgb.g, rgb.b));
			if (maximum <= 0.0) { return 0.0; }
			return (maximum - minimum) / maximum;
		}
		default: { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
	}
}

fn comes_before(leftKey: f32, leftSample: u32, rightKey: f32, rightSample: u32) -> bool {
	// ソート網の余りは常に末尾へ送る。無効値を極端な輝度として扱わないため、
	// ソート順やHDRの値域によらず、有効な画素だけから順位を選べる。
	if (leftSample == INVALID_SAMPLE) { return false; }
	if (rightSample == INVALID_SAMPLE) { return true; }
	if (leftKey != rightKey) {
		return select((leftKey < rightKey), (leftKey > rightKey), uniforms.descending != 0u);
	}
	// sampleIndexは新しい順。同じキーではソート方向によらず新しい時刻を優先する。
	return leftSample < rightSample;
}

@fragment
fn sort_history(@location(0) position: vec2f) -> @location(0) vec4f {
	let current = read_input(position);
	let amount = clamp(read_amount(position), 0.0, 1.0);
	if (uniforms.historyCount == 0u || amount <= 0.0) { return current; }

	// SORT_CAPACITYは保存枚数以上で最小の2の累乗としてJS側で定義する。
	// 色全体を各画素のローカル配列へ複製せず、キーと元の候補番号だけを並べ替える。
	var sortedKeys: array<f32, SORT_CAPACITY>;
	var sampleOrder: array<u32, SORT_CAPACITY>;
	for (var slot = 0u; slot < SORT_CAPACITY; slot++) {
		sortedKeys[slot] = 0.0;
		sampleOrder[slot] = INVALID_SAMPLE;
	}
	var validCount = 0u;
	for (var sampleIndex = 0u; sampleIndex <= uniforms.historyCount; sampleIndex++) {
		let color = sample_candidate(position, current, sampleIndex);
		if (uniforms.ignoreTransparent != 0u && color.a <= 0.0) { continue; }
		sortedKeys[validCount] = sort_key(color);
		sampleOrder[validCount] = sampleIndex;
		validCount++;
	}
	if (validCount == 0u) { return current; }
	if (validCount == 1u) {
		// 透明な候補を除外して1色だけになった場合は、順位によらず同じ色になる。
		return mix(current, sample_candidate(position, current, sampleOrder[0]), amount);
	}

	// Bitonic sort。各画素の時間方向だけを並べ替え、空間上の画素位置は変えない。
	// 保存枚数に応じたサイズへ特殊化し、少ない履歴で64枚分の比較を繰り返さないようにする。
	for (var sequenceSize = 2u; sequenceSize <= SORT_CAPACITY; sequenceSize *= 2u) {
		for (var stride = sequenceSize / 2u; stride > 0u; stride /= 2u) {
			for (var leftIndex = 0u; leftIndex < SORT_CAPACITY; leftIndex++) {
				let rightIndex = leftIndex ^ stride;
				if (rightIndex <= leftIndex) { continue; }
				let forward = (leftIndex & sequenceSize) == 0u;
				let exchange = select(
					comes_before(sortedKeys[leftIndex], sampleOrder[leftIndex], sortedKeys[rightIndex], sampleOrder[rightIndex]),
					comes_before(sortedKeys[rightIndex], sampleOrder[rightIndex], sortedKeys[leftIndex], sampleOrder[leftIndex]),
					forward,
				);
				if (exchange) {
					let savedKey = sortedKeys[leftIndex];
					let savedSample = sampleOrder[leftIndex];
					sortedKeys[leftIndex] = sortedKeys[rightIndex];
					sampleOrder[leftIndex] = sampleOrder[rightIndex];
					sortedKeys[rightIndex] = savedKey;
					sampleOrder[rightIndex] = savedSample;
				}
			}
		}
	}
	let rank = clamp(read_rank(position), 0.0, 1.0) * f32(validCount - 1u);
	var selected = vec4f(0.0);
	if (uniforms.interpolateRanks != 0u) {
		let lowerRank = u32(floor(rank));
		let upperRank = min(lowerRank + 1u, validCount - 1u);
		let lowerColor = sample_candidate(position, current, sampleOrder[lowerRank]);
		let upperColor = sample_candidate(position, current, sampleOrder[upperRank]);
		// RGBAをまとめて補間することで、時刻ごとに透明度が違っても色の輪郭を保つ。
		selected = mix(lowerColor, upperColor, fract(rank));
	} else {
		selected = sample_candidate(position, current, sampleOrder[u32(round(rank))]);
	}
	if (selected.a <= 0.0) { selected = vec4f(0.0); }
	return mix(current, selected, amount);
}
