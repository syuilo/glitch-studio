@group(0) @binding(1) var distanceTexture: texture_2d<f32>;
@group(0) @binding(2) var sceneTexture: texture_2d<f32>;

fn hash(value: u32) -> u32 {
	var result = value;
	result = (result ^ (result >> 16u)) * 0x7feb352du;
	result = (result ^ (result >> 15u)) * 0x846ca68bu;
	return result ^ (result >> 16u);
}

fn traceRay(origin: vec2f, direction: vec2f) -> vec3f {
	var position = origin;
	var traveled = 0.0;
	for (var step = 0u; step < uniforms.maxSteps; step++) {
		if (outsideScene(position)) { break; }
		let pixel = vec2i(floor(position));
		// 衝突・歩幅は補間しない。細い壁や異なる物体の間に仮の値を作らないため。
		let surface = textureLoad(sceneTexture, pixel, 0);
		if (occupied(surface)) {
			// 最短辺を2とする等方的な距離。解像度や縦横比で減衰の形を歪めない。
			let distance = traveled * 2.0 / min(uniforms.sceneSize.x, uniforms.sceneSize.y);
			return max(surface.rgb, vec3f(0.0)) * exp(-uniforms.absorption * distance);
		}
		let distance = textureLoad(distanceTexture, pixel, 0).r;
		if (distance < 0.0) { break; }
		var advance = distance;
		if (advance < 1.0) { advance = nextPixelDistance(position, direction); }
		position += direction * advance;
		traveled += advance;
	}
	// 画面外・ステップ上限では光を加えない。既定のwrap設定で画面を周回させない。
	return vec3f(0.0);
}

@fragment
fn trace(frag: FragmentIn) -> @location(0) vec4f {
	// 補間されたUVの丸めで整数境界の反対側を読むのを避け、拡大時と同じ計算点を使う。
	let origin = frag.pixelPosition.xy / uniforms.lightingSize * uniforms.sceneSize;
	if (occupied(textureLoad(sceneTexture, vec2i(origin), 0))) { return vec4f(0.0); }
	let pixel = vec2u(floor(origin));
	let pixelSeed = hash(pixel.x ^ hash(pixel.y) ^ hash(uniforms.seed));
	var radiance = vec3f(0.0);
	for (var ray = 0u; ray < uniforms.rayCount; ray++) {
		// 角度を層化して偏りを減らす。時刻・フレーム数を使わず、シーク後も同じ結果にする。
		let jitter = f32(hash(pixelSeed ^ hash(ray)) >> 8u) / 16777216.0;
		let angle = 6.28318530718 * (f32(ray) + jitter) / f32(uniforms.rayCount);
		radiance += traceRay(origin, vec2f(cos(angle), sin(angle)));
	}
	return vec4f(radiance * uniforms.emissionStrength / f32(uniforms.rayCount), 0.0);
}
