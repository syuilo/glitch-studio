// 整数の格子座標とseedだけから値を作る。描画回数や画素座標の乱数を使わず、
// シーク・解像度変更・描画順序の違いでも同じ表面を再現する。
fn surfaceLatticeValue(cell: vec3i) -> f32 {
	let coordinate = bitcast<vec3u>(cell);
	var hash = uniforms.surfaceWavinessSeed ^ (coordinate.x * 1597334677u)
		^ (coordinate.y * 3812015801u) ^ (coordinate.z * 2798796415u);
	hash = (hash ^ (hash >> 16u)) * 0x7feb352du;
	hash = (hash ^ (hash >> 15u)) * 0x846ca68bu;
	hash = hash ^ (hash >> 16u);
	return f32(hash >> 8u) * (2.0 / 16777215.0) - 1.0;
}

// 戻り値は高さ・X微分・Y微分。5次補間の解析的な微分を使うことで、
// 画素幅の差分に由来する解像度依存や、小さな揺らぎの消失を避ける。
fn surfaceValueNoise(position: vec3f) -> vec3f {
	let cell = vec3i(floor(position));
	let fraction = fract(position);
	let blend = fraction * fraction * fraction * (fraction * (fraction * 6.0 - 15.0) + 10.0);
	let derivative = 30.0 * fraction * fraction * (fraction - 1.0) * (fraction - 1.0);
	let v000 = surfaceLatticeValue(cell);
	let v100 = surfaceLatticeValue(cell + vec3i(1, 0, 0));
	let v010 = surfaceLatticeValue(cell + vec3i(0, 1, 0));
	let v110 = surfaceLatticeValue(cell + vec3i(1, 1, 0));
	let v001 = surfaceLatticeValue(cell + vec3i(0, 0, 1));
	let v101 = surfaceLatticeValue(cell + vec3i(1, 0, 1));
	let v011 = surfaceLatticeValue(cell + vec3i(0, 1, 1));
	let v111 = surfaceLatticeValue(cell + vec3i(1, 1, 1));
	let x00 = mix(v000, v100, blend.x);
	let x10 = mix(v010, v110, blend.x);
	let x01 = mix(v001, v101, blend.x);
	let x11 = mix(v011, v111, blend.x);
	let value = mix(mix(x00, x10, blend.y), mix(x01, x11, blend.y), blend.z);
	let gradientX = mix(mix(v100 - v000, v110 - v010, blend.y), mix(v101 - v001, v111 - v011, blend.y), blend.z) * derivative.x;
	let gradientY = mix(x10 - x00, x11 - x01, blend.z) * derivative.y;
	return vec3f(value, gradientX, gradientY);
}

fn surfaceWavinessGradient(position: vec2f, distance: f32, distanceGradient: vec2f) -> vec2f {
	if (uniforms.surfaceWavinessAmplitude <= 0.0) { return vec2f(0.0); }
	let noisePosition = position / uniforms.surfaceWavinessScale;
	let coarse = surfaceValueNoise(vec3f(noisePosition, uniforms.surfaceWavinessTime));
	// 大小2つの滑らかな模様をずらして重ね、格子状の平坦な筋が同じ位置に揃わないようにする。
	let fine = surfaceValueNoise(vec3f(noisePosition * 2.07 + vec2f(19.1, 7.3), uniforms.surfaceWavinessTime + 11.7));
	let value = coarse.x * 0.7 + fine.x * 0.3;
	let gradient = (coarse.yz * 0.7 + fine.yz * (0.3 * 2.07)) / uniforms.surfaceWavinessScale;
	// 輪郭で揺らぎの高さを0へ落とす。積の微分も含め、縁と内部の法線が不自然に分断されるのを防ぐ。
	// Bevel Widthが0でも、最短辺の1%を使ってマスクの縁へ滑らかにつなぐ。
	let fadeWidth = max(uniforms.bevelWidth, 0.02);
	let t = clamp(distance / fadeWidth, 0.0, 1.0);
	let fade = t * t * (3.0 - 2.0 * t);
	let fadeDerivative = 6.0 * t * (1.0 - t) / fadeWidth;
	return uniforms.surfaceWavinessAmplitude * (gradient * fade + value * fadeDerivative * distanceGradient);
}
