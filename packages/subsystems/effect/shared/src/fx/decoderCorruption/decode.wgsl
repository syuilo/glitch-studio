@group(0) @binding(1) var<storage, read> originalSamples: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> decodedSamples: array<DecodedSample>;
@group(0) @binding(3) var<storage, read> descriptors: array<vec4u>;

var<workgroup> sharedPacket: vec4u;
var<workgroup> sharedBlock: vec4u;
var<workgroup> originalTop: array<vec3f, 16>;
var<workgroup> originalLeft: array<vec3f, 16>;
var<workgroup> decodedTop: array<vec3f, 16>;
var<workgroup> decodedLeft: array<vec3f, 16>;
var<workgroup> originalMean: vec3f;
var<workgroup> decodedMean: vec3f;
// 正しい予測方式、復号側の予測方式、破損中か、元画像から復旧するかの順。
var<workgroup> predictionState: vec4u;
// xyzは今回だけ注入する成分誤差、wは残差へ掛ける倍率。
var<workgroup> blockDamage: vec4f;
var<workgroup> referenceOffsets: vec2i;

fn decoded_reference(point: vec2i, packetOrigin: vec2u) -> vec3f {
	let index = sample_index(clamped_sample_position(point));
	let original = originalSamples[index];
	// 区画の上辺・左辺では元画像を参照し、別workgroupの完了順に依存しない再同期点にする。
	// 区画内の参照は必ず処理済みの葉へ向かい、葉ごとのstorageBarrierで可視化されている。
	if (any(point < vec2i(packetOrigin))) { return original.rgb; }
	// 透明な画素の破損色が不透明な領域へ伝わることを防ぐ。
	return original.rgb + (decodedSamples[index].color - original.rgb) * (uniforms.propagation * original.a);
}

fn top_reference(index: u32, reconstructed: bool) -> vec3f {
	if (reconstructed) { return decodedTop[index]; }
	return originalTop[index];
}

fn left_reference(index: u32, reconstructed: bool) -> vec3f {
	if (reconstructed) { return decodedLeft[index]; }
	return originalLeft[index];
}

fn predict(mode: u32, point: vec2u, size: u32, reconstructed: bool, offsets: vec2i) -> vec3f {
	let topIndex = u32(clamp(i32(point.x) + offsets.x, 0, i32(size) - 1));
	let leftIndex = u32(clamp(i32(point.y) + offsets.y, 0, i32(size) - 1));
	let top = top_reference(topIndex, reconstructed);
	let left = left_reference(leftIndex, reconstructed);
	if (mode == 0u) { return left; }
	if (mode == 1u) { return top; }
	if (mode == 2u) {
		if (reconstructed) { return decodedMean; }
		return originalMean;
	}
	// 上辺・左辺と、その両端から作る平面状の予測。境界の参照位置を制限するため、
	// ずれが大きいと端の色が繰り返され、誤った予測による模様の引き伸ばしになる。
	let weight = (vec2f(point) + vec2f(1.0)) / f32(size + 1u);
	let topRight = top_reference(u32(clamp(i32(size) - 1 + offsets.x, 0, i32(size) - 1)), reconstructed);
	let bottomLeft = left_reference(u32(clamp(i32(size) - 1 + offsets.y, 0, i32(size) - 1)), reconstructed);
	return (mix(left, topRight, weight.x) + mix(top, bottomLeft, weight.y)) * 0.5;
}

fn choose_prediction(block: vec4u) -> u32 {
	if (uniforms.predictionMode != 0u) { return uniforms.predictionMode - 1u; }
	var costs = vec4f(0.0);
	// 全画素で4方式を評価すると小ブロックが多い設定で高価になるため、最大4×4点で比較する。
	// 1×1・2×2の葉では同じ画素を繰り返し評価せず、その葉の画素数だけを使う。
	// 色差も評価し、輝度が同じ色同士の境界で不適切な予測を選び続けることを避ける。
	let samplingSize = min(4u, block.z);
	for (var y = 0u; y < samplingSize; y++) {
		for (var x = 0u; x < samplingSize; x++) {
			let point = vec2u(x * block.z + block.z / 2u, y * block.z + block.z / 2u) / samplingSize;
			let original = originalSamples[sample_index(block.xy + point)].rgb;
			for (var mode = 0u; mode < 4u; mode++) {
				let error = original - predict(mode, point, block.z, false, vec2i(0));
				costs[mode] += dot(error * error, vec3f(1.0, 0.25, 0.25));
			}
		}
	}
	var bestMode = 0u;
	for (var mode = 1u; mode < 4u; mode++) {
		if (costs[mode] < costs[bestMode]) { bestMode = mode; }
	}
	return bestMode;
}

@compute @workgroup_size(64)
fn decode(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
	let packetIndex = group.y * uniforms.packetColumns + group.x;
	let packetOrigin = group.xy * uniforms.packetSize;
	if (lane == 0u) { sharedPacket = descriptors[packetIndex]; }
	// storage由来のループ回数・葉の寸法を明示的にworkgroup内の一様な値へする。
	// 全invocationが同じ回数のbarrierを通ることを、WGSLのuniformity解析にも保証する。
	let packet = workgroupUniformLoad(&sharedPacket);
	var burstRemaining = 0u;
	var burstModeOffset = 0u;
	var burstReferenceShift = vec2f(0.0);
	var burstResidualGain = 1.0;
	for (var blockIndex = 0u; blockIndex < packet.y; blockIndex++) {
		if (lane == 0u) { sharedBlock = descriptors[packet.x + blockIndex]; }
		let block = workgroupUniformLoad(&sharedBlock);
		let size = block.z;
		if (lane < size) {
			let topPosition = vec2i(block.xy) + vec2i(i32(lane), -1);
			let leftPosition = vec2i(block.xy) + vec2i(-1, i32(lane));
			originalTop[lane] = originalSamples[sample_index(clamped_sample_position(topPosition))].rgb;
			originalLeft[lane] = originalSamples[sample_index(clamped_sample_position(leftPosition))].rgb;
			decodedTop[lane] = decoded_reference(topPosition, packetOrigin);
			decodedLeft[lane] = decoded_reference(leftPosition, packetOrigin);
		}
		workgroupBarrier();
		if (lane == 0u) {
			originalMean = vec3f(0.0);
			decodedMean = vec3f(0.0);
			for (var index = 0u; index < size; index++) {
				originalMean += originalTop[index] + originalLeft[index];
				decodedMean += decodedTop[index] + decodedLeft[index];
			}
			originalMean /= f32(size * 2u);
			decodedMean /= f32(size * 2u);
			let correctMode = choose_prediction(block);
			predictionState = vec4u(correctMode, correctMode, 0u, 0u);
			blockDamage = vec4f(0.0, 0.0, 0.0, 1.0);
			referenceOffsets = vec2i(0);
			if (random(block.w, 1u) < uniforms.recoveryProbability) {
				// 復旧ブロックは残差を戻すだけでなく元画像へ戻し、周辺から来た誤差も断ち切る。
				predictionState.w = 1u;
				burstRemaining = 0u;
			} else {
				if (burstRemaining == 0u && random(block.w, 2u) < uniforms.corruptionProbability) {
					burstRemaining = max(1u, u32(round(f32(uniforms.burstLength) * (0.5 + random(block.w, 3u)))));
					burstModeOffset = 0u;
					if (random(block.w, 4u) < uniforms.predictionError) {
						burstModeOffset = 1u + u32(random(block.w, 5u) * 3.0);
					}
					burstReferenceShift = (vec2f(random(block.w, 6u), random(block.w, 7u)) * 2.0 - vec2f(1.0)) * uniforms.referenceShift;
					var residualMode = uniforms.residualMode;
					if (residualMode == 0u) { residualMode = 1u + u32(random(block.w, 8u) * 3.0); }
					var targetGain = 0.0;
					if (residualMode == 2u) { targetGain = -1.0; }
					if (residualMode == 3u) { targetGain = 2.0 + random(block.w, 9u) * 4.0; }
					burstResidualGain = mix(1.0, targetGain, uniforms.residualError);
					// 同じDC誤差を毎ブロック加えると線形に増大するため、発生時だけ注入する。
					// その後の広がりは、復元済みの上辺・左辺を使う予測そのものへ任せる。
					blockDamage = vec4f(
						(random(block.w, 10u) * 2.0 - 1.0) * uniforms.luminanceError,
						(random(block.w, 11u) * 2.0 - 1.0) * uniforms.chromaError,
						(random(block.w, 12u) * 2.0 - 1.0) * uniforms.chromaError,
						1.0,
					);
				}
				if (burstRemaining > 0u) {
					predictionState.y = (correctMode + burstModeOffset) % 4u;
					predictionState.z = 1u;
					referenceOffsets = vec2i(round(burstReferenceShift * f32(size)));
					blockDamage.w = burstResidualGain;
					burstRemaining--;
				}
			}
		}
		workgroupBarrier();
		for (var pixelIndex = lane; pixelIndex < size * size; pixelIndex += 64u) {
			let point = vec2u(pixelIndex % size, pixelIndex / size);
			let index = sample_index(block.xy + point);
			let original = originalSamples[index];
			var reconstructed = original.rgb;
			var detailGain = 1.0;
			if (predictionState.w == 0u) {
				let originalPrediction = predict(predictionState.x, point, size, false, vec2i(0));
				let decodedPrediction = predict(predictionState.y, point, size, true, referenceOffsets);
				var residual = (original.rgb - originalPrediction) * blockDamage.w;
				if (predictionState.z != 0u) {
					// 2×2サンプルごとの残差誤りで細かな破損を重ねる。画面の実ピクセル数には依存しない。
					let noiseIdentity = block.w ^ ((point.x / 2u) * 0x9e3779b9u) ^ ((point.y / 2u) * 0x85ebca6bu);
					let noise = vec3f(random(noiseIdentity, 20u), random(noiseIdentity, 21u), random(noiseIdentity, 22u)) * 2.0 - vec3f(1.0);
					residual += noise * vec3f(0.3, 1.0, 1.0) * uniforms.residualNoise;
				}
				reconstructed = clamp(decodedPrediction + residual + blockDamage.xyz, vec3f(0.0, -0.5, -0.5), vec3f(1.0, 0.5, 0.5));
				detailGain = blockDamage.w;
			}
			if (original.a <= 0.0) { reconstructed = vec3f(0.0); }
			decodedSamples[index] = DecodedSample(reconstructed, size, detailGain);
		}
		// 次の葉が読む境界画素を確定させる。区画内の順序だけを同期し、区画間には依存を作らない。
		storageBarrier();
	}
}
