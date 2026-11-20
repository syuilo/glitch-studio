struct Uniforms {
	regionSizeA: vec2f,
	regionSizeB: vec2f,
	regionOffsetA: vec2f,
	regionOffsetB: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct RegionSample {
	position: vec2f,
	coverage: f32,
};

fn regionSample(pixelPosition: vec2f, offset: vec2f, size: vec2f) -> RegionSample {
	if (any(size <= vec2f(0.0))) { return RegionSample(vec2f(0.0), 0.0); }
	// 画素と領域の交差面積を被覆率にする。幅1px未満の領域やGapも連続的に描画し、
	// Gap=0ではA/Bの被覆率の和を1に保って透明な継ぎ目を生じさせない。
	let start = max(pixelPosition - 0.5, offset);
	let end = min(pixelPosition + 0.5, offset + size);
	let coveredSize = max(end - start, vec2f(0.0));
	let coverage = coveredSize.x * coveredSize.y;
	if (coverage <= 0.0) { return RegionSample(vec2f(0.0), 0.0); }
	// 境界画素は実際に覆われた範囲の中心で読む。画素中心が領域外でも、
	// RepeatなどのWrapで反対側の画像を読み出すことを防ぐ。
	let localPosition = ((start + end) * 0.5 - offset) / size;
	return RegionSample(localPosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), coverage);
}

@fragment
fn fs(@builtin(position) pixelPosition: vec4f) -> @location(0) vec4f {
	let sampleA = regionSample(pixelPosition.xy, uniforms.regionOffsetA, uniforms.regionSizeA);
	let sampleB = regionSample(pixelPosition.xy, uniforms.regionOffsetB, uniforms.regionSizeB);
	var color = vec4f(0.0);
	// 入力は乗算済みRGBA。source-overではなく各領域の被覆率で加算し、
	// 半透明同士の境界でもalphaを二重乗算せず、HDR・負値を保持する。
	if (sampleA.coverage > 0.0) { color += read_inputA(sampleA.position) * sampleA.coverage; }
	if (sampleB.coverage > 0.0) { color += read_inputB(sampleB.position) * sampleB.coverage; }
	return color;
}
