@group(0) @binding(1) var fieldSampler: sampler;
@group(0) @binding(2) var capturedColor: texture_2d<f32>;
@group(0) @binding(3) var guidance: texture_2d<f32>;
@group(0) @binding(4) var previousError: texture_2d<f32>;

fn image_color(pixel: vec2f) -> vec4f {
	return straight_color(textureSampleLevel(capturedColor, fieldSampler, pixel / uniforms.textureSize, 0.0));
}

fn gradient_tensor(pixel: vec2f) -> vec3f {
	let radius = uniforms.guidanceRadius;
	let dx = image_color(pixel + vec2f(radius, 0.0)) - image_color(pixel - vec2f(radius, 0.0));
	let dy = image_color(pixel + vec2f(0.0, radius)) - image_color(pixel - vec2f(0.0, radius));
	// RGBとalphaの勾配をまとめた構造テンソル。輝度が同じ色同士の境界や、
	// 色が一定の図形の透明な輪郭も、方向を決める手掛かりとして扱う。
	return vec3f(dot(dx, dx), dot(dx, dy), dot(dy, dy));
}

@fragment
fn analyze(@builtin(position) position: vec4f) -> @location(0) vec4f {
	var direction = uniforms.fallbackDirection;
	var confidence = 0.0;
	if (uniforms.flowMode != 2u && uniforms.following > 0.0) {
		// 中央だけの微分では細かい模様で方向が反転しやすいので、近傍のテンソルを平均する。
		let radius = uniforms.guidanceRadius * 0.5;
		let tensor = (gradient_tensor(position.xy) * 2.0
			+ gradient_tensor(position.xy + vec2f(radius, 0.0))
			+ gradient_tensor(position.xy - vec2f(radius, 0.0))
			+ gradient_tensor(position.xy + vec2f(0.0, radius))
			+ gradient_tensor(position.xy - vec2f(0.0, radius))) / 6.0;
		let trace = tensor.x + tensor.z;
		if (trace > 0.00000001) {
			let angle = 0.5 * atan2(2.0 * tensor.y, tensor.x - tensor.z);
			let normal = vec2f(cos(angle), sin(angle));
			var contentDirection = normal;
			if (uniforms.flowMode == 0u) { contentDirection = vec2f(-normal.y, normal.x); }
			// この場は向きのない軸。固定方向と符号を揃えてから混ぜ、打ち消しを避ける。
			if (dot(contentDirection, direction) < 0.0) { contentDirection = -contentDirection; }
			let separation = sqrt(max(0.0, (tensor.x - tensor.z) * (tensor.x - tensor.z) + 4.0 * tensor.y * tensor.y));
			confidence = clamp(separation / trace, 0.0, 1.0) * smoothstep(0.005, 0.05, sqrt(trace));
			direction = mix(direction, contentDirection, uniforms.following * confidence);
		}
	}
	direction /= max(length(direction), 0.000001);
	return vec4f(direction, confidence, 0.0);
}

@fragment
fn initialize_error(@builtin(position) position: vec4f) -> @location(0) vec4f {
	if (uniforms.sourceProbability <= 0.0 || uniforms.sourceSize <= 0.0 || any(position.xy >= uniforms.virtualSize)) {
		return vec4f(0.0);
	}
	// 座標は画面短辺を1とする。解像度が変わっても発生位置・サイズは変わらない。
	let point = position.xy / uniforms.analysisResolution;
	let cell = vec2i(floor(point / uniforms.sourceSpacing));
	let radius = uniforms.sourceSpacing * uniforms.sourceSize * 0.5;
	var error = vec4f(0.0);
	for (var y = -1i; y <= 1i; y++) {
		for (var x = -1i; x <= 1i; x++) {
			let neighbor = cell + vec2i(x, y);
			if (random(neighbor, 1u) >= uniforms.sourceProbability) { continue; }
			let jitter = vec2f(random(neighbor, 2u), random(neighbor, 3u)) * 0.5 + 0.25;
			let center = (vec2f(neighbor) + jitter) * uniforms.sourceSpacing;
			let weight = 1.0 - smoothstep(radius * 0.6, radius, distance(point, center));
			// 隣接セルの円も調べ、セル境界で誤差の発生領域が切れないようにする。
			if (weight > error.a) { error = vec4f(source_error(neighbor) * weight, weight); }
		}
	}
	// 透明な場所から誤差を発生させない。最終画像のalphaは別に元画像から保持する。
	return error * clamp(image_color(position.xy).a, 0.0, 1.0);
}

fn flow_direction(pixel: vec2f, fallback: vec2f) -> vec2f {
	let direction = textureSampleLevel(guidance, fieldSampler, pixel / uniforms.textureSize, 0.0).xy;
	let magnitude = length(direction);
	if (magnitude <= 0.000001) { return fallback; }
	var result = direction / magnitude;
	// 双方向に伝播するため、隣接地点の軸の符号が反転しても同じ経路をたどれるようにする。
	if (dot(result, fallback) < 0.0) { result = -result; }
	return result;
}

fn transported_error(pixel: vec2f, direction: vec2f, sign: f32, centerColor: vec4f) -> vec4f {
	// 中点の方向を使って経路を更新し、直線の移動だけで輪郭を飛び越えることを抑える。
	let midpoint = pixel + direction * (sign * uniforms.stepDistance * 0.5);
	let middleDirection = flow_direction(midpoint, direction);
	let source = pixel + middleDirection * (sign * uniforms.stepDistance);
	if (any(source < vec2f(0.0)) || any(source >= uniforms.virtualSize)) { return vec4f(0.0); }
	var transmission = uniforms.stepDecay;
	if (uniforms.boundaryStrength > 0.0) {
		var previousColor = centerColor;
		let segmentDistance = max(distance(pixel, source) / 4.0, 0.000001);
		// 始点・終点だけでは、途中にある細い境界を見落とすため、経路を4分割して確認する。
		for (var i = 1u; i <= 4u; i++) {
			let color = image_color(mix(pixel, source, f32(i) / 4.0));
			// 小さいステップでは差分を解析画像の1サンプル分へ換算する。
			// 反復数を増やすだけで境界を通過しやすくなることを抑えるため。
			let difference = max(length(color.rgb - previousColor.rgb) * 0.57735026919, abs(color.a - previousColor.a)) / min(1.0, segmentDistance);
			let blocked = smoothstep(uniforms.boundaryThreshold, uniforms.boundaryThreshold * 2.0, difference);
			transmission *= pow(1.0 - uniforms.boundaryStrength * blocked, segmentDistance);
			previousColor = color;
		}
	}
	return textureSampleLevel(previousError, fieldSampler, source / uniforms.textureSize, 0.0) * transmission;
}

@fragment
fn propagate(@builtin(position) position: vec4f) -> @location(0) vec4f {
	if (any(position.xy >= uniforms.virtualSize)) { return vec4f(0.0); }
	var error = textureSampleLevel(previousError, fieldSampler, position.xy / uniforms.textureSize, 0.0);
	let direction = flow_direction(position.xy, uniforms.fallbackDirection);
	let color = image_color(position.xy);
	let forward = transported_error(position.xy, direction, 1.0, color);
	let backward = transported_error(position.xy, direction, -1.0, color);
	// 最も強い到達誤差を残す。元の発生地点を保ちつつ経路を伸ばし、
	// 反復ごとの加算による発散や、相反する色の誤差の打ち消しを避ける。
	if (forward.a > error.a) { error = forward; }
	if (backward.a > error.a) { error = backward; }
	return error;
}
