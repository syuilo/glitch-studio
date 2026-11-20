@group(0) @binding(1) var<storage, read> partialStatistics: array<StatisticsPair>;
@group(0) @binding(2) var<storage, read_write> paletteTransform: PaletteTransform;
var<workgroup> samples: array<StatisticsPair, 64>;

@compute @workgroup_size(64)
fn buildTransform(@builtin(local_invocation_index) lane: u32) {
	var pair = StatisticsPair(emptyStatistics(), emptyStatistics());
	for (var index = lane; index < uniforms.partialCount; index += 64u) {
		pair = combinePairs(pair, partialStatistics[index]);
	}
	samples[lane] = pair;
	workgroupBarrier();
	for (var stride = 32u; stride > 0u; stride /= 2u) {
		if (lane < stride) { samples[lane] = combinePairs(samples[lane], samples[lane + stride]); }
		workgroupBarrier();
	}
	if (lane != 0u) { return; }
	let input = samples[0].input;
	let reference = samples[0].reference;
	paletteTransform.hasTransform = 0u;
	// マスクや透明度で解析対象がなくなったときは、前のフレームの変換を使わない。
	if (input.meanAndWeight.w <= 0.0 || reference.meanAndWeight.w <= 0.0) { return; }
	let inputCovariance = covariance(input);
	let referenceCovariance = covariance(reference);
	// 統計が同じなら恒等変換。特に自分自身を参照にした場合、色空間変換の
	// 往復や特異な共分散の正則化だけで元画像を変えてしまわないようにする。
	if (all(input.meanAndWeight.xyz == reference.meanAndWeight.xyz)
		&& all(inputCovariance[0] == referenceCovariance[0])
		&& all(inputCovariance[1] == referenceCovariance[1])
		&& all(inputCovariance[2] == referenceCovariance[2])) { return; }
	paletteTransform.inputMean = vec4f(input.meanAndWeight.xyz, 0.0);
	paletteTransform.referenceMean = vec4f(reference.meanAndWeight.xyz, 0.0);
	paletteTransform.matrix = covarianceTransform(inputCovariance, referenceCovariance);
	paletteTransform.hasTransform = 1u;
}
