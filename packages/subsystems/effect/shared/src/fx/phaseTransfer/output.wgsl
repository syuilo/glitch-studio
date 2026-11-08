@group(0) @binding(1) var<storage, read> differences: array<ComplexColor>;

fn differenceAt(point: vec2i, block: u32) -> vec3f {
	var bounded = clamp(point, vec2i(0), vec2i(uniforms.transform.transformSize) - 1);
	if (uniforms.processing == 0u) { bounded = ((point % vec2i(uniforms.transform.transformSize)) + vec2i(uniforms.transform.transformSize)) % vec2i(uniforms.transform.transformSize); }
	return differences[sampleOffset(vec2u(bounded), block)].real.rgb;
}

fn sampleDifference(local: vec2f, block: u32) -> vec3f {
	let pixel = local * vec2f(uniforms.transform.transformSize) - 0.5;
	let first = vec2i(floor(pixel));
	let weight = fract(pixel);
	return mix(
		mix(differenceAt(first, block), differenceAt(first + vec2i(1, 0), block), weight.x),
		mix(differenceAt(first + vec2i(0, 1), block), differenceAt(first + vec2i(1, 1), block), weight.x),
		weight.y,
	);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let uv = position.xy / uniforms.resolution;
	let original = read_input(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
	if (uniforms.processingEnabled == 0u) { return original; }
	if (original.a <= 0.0) { return vec4f(0.0); }
	var difference = vec3f(0.0);
	if (uniforms.processing == 0u) {
		difference = sampleDifference(uv / uniforms.tileSize, 0u);
	} else {
		let preceding = vec2u(floor(uv / (uniforms.tileSize * 0.5)));
		var totalWeight = 0.0;
		for (var y = 0u; y < 2u; y++) {
			for (var x = 0u; x < 2u; x++) {
				let blockPosition = preceding + vec2u(x, y);
				let block = blockPosition.y * uniforms.blockGrid.x + blockPosition.x;
				let local = clamp((uv - blockOrigin(block)) / uniforms.tileSize, vec2f(0.0), vec2f(1.0));
				// 50%重なる周期Hann窓は各軸で和が1になる。合成時だけ窓を掛けることで、
				// 一様な入力を解析窓の形として乱すことなく、ブロック境界の継ぎ目を抑える。
				let window = 0.5 - 0.5 * cos(tau * local);
				let weight = window.x * window.y;
				difference += sampleDifference(local, block) * weight;
				totalWeight += weight;
			}
		}
		difference /= max(totalWeight, 0.000001);
	}
	// FFTは乗算済みRGBを解析する。差分だけを元のalphaで制限して透明領域への
	// 漏れを防ぎ、元RGBへは再度alphaを掛けない。HDR・負のRGBも飽和させない。
	return vec4f(original.rgb + difference * original.a, original.a);
}
