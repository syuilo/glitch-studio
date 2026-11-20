@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var lightingTexture: texture_2d<f32>;

fn visibleNeighbor(origin: vec2f, destination: vec2f) -> bool {
	let delta = destination - origin;
	let distance = length(delta);
	if (distance < 0.001) { return true; }
	let direction = delta / distance;
	var position = origin;
	var traveled = 0.0;
	// Resolution Scaleの下限は1/4。双線形補間の4点までの線分は最大でも8画素を横切る。
	// 元解像度で遮蔽を確認し、縮小した照明を壁の反対側から補間しない。
	for (var step = 0; step < 16; step++) {
		if (occupied(textureLoad(sceneTexture, vec2i(floor(position)), 0))) { return false; }
		if (traveled >= distance) { return true; }
		let advance = min(nextPixelDistance(position, direction), distance - traveled);
		position += direction * advance;
		traveled += advance;
	}
	return false;
}

fn sampleLighting(position: vec2f, pixel: vec2i) -> vec3f {
	let size = vec2i(textureDimensions(lightingTexture));
	if (all(size == vec2i(uniforms.sceneSize))) { return textureLoad(lightingTexture, pixel, 0).rgb; }
	let coordinate = position / uniforms.sceneSize * vec2f(size) - 0.5;
	let base = vec2i(floor(coordinate));
	let fraction = fract(coordinate);
	var radiance = vec3f(0.0);
	var totalWeight = 0.0;
	for (var y = 0; y <= 1; y++) {
		for (var x = 0; x <= 1; x++) {
			let neighbor = clamp(base + vec2i(x, y), vec2i(0), size - 1);
			let destination = (vec2f(neighbor) + 0.5) / vec2f(size) * uniforms.sceneSize;
			if (!visibleNeighbor(position, destination)) { continue; }
			let weights = select(1.0 - fraction, fraction, vec2i(x, y) == vec2i(1));
			let weight = weights.x * weights.y;
			radiance += textureLoad(lightingTexture, neighbor, 0).rgb * weight;
			totalWeight += weight;
		}
	}
	return radiance / max(totalWeight, 0.00001);
}

@fragment
fn composite(frag: FragmentIn) -> @location(0) vec4f {
	let pixel = vec2i(frag.pixelPosition.xy);
	// 入力図形は元解像度の同一画素で読む。照明の計算解像度で輪郭をぼかさない。
	let source = textureLoad(sceneTexture, pixel, 0);
	var radiance = vec3f(0.0);
	if (uniforms.emissionStrength > 0.0 && source.a < 1.0) {
		radiance = sampleLighting(frag.pixelPosition.xy, pixel);
	}
	// 光の場を黒背景に表示し、その上へ乗算済みの入力図形を重ねる。
	// 入力のαを出力へコピーすると、透明な領域に広がった光まで消えてしまう。
	return vec4f(max(source.rgb + radiance * (1.0 - clamp(source.a, 0.0, 1.0)), vec3f(0.0)), 1.0);
}
