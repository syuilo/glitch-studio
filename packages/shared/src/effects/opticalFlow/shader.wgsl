struct Params {
	texelSize: vec2f,
	seconds: f32,
	strength: f32,
	confidence: f32,
	smoothing: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(3) var previous: texture_2d<f32>;
@group(0) @binding(4) var current: texture_2d<f32>;
@group(0) @binding(5) var flow: texture_2d<f32>;

fn texCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + 0.5;
}

fn intensities(point: vec2i) -> vec2f {
	// 整数グリッド上の差分を求めるため、隣接画素を混ぜずに読む。
	let coord = clamp(point, vec2i(0), vec2i(textureDimensions(current)) - 1);
	return vec2f(textureLoad(previous, coord, 0).r, textureLoad(current, coord, 0).r);
}

@fragment
fn estimate(@builtin(position) position: vec4f) -> @location(0) vec2f {
	let center = vec2i(position.xy);
	var xx = 0.0;
	var xy = 0.0;
	var yy = 0.0;
	var xt = 0.0;
	var yt = 0.0;
	var tt = 0.0;
	// Differential Lucas-Kanade over a 5x5 neighborhood.
	// ponytail: single-scale estimation handles small motion; use a pyramid for large displacements.
	for (var y = -2; y <= 2; y++) {
		for (var x = -2; x <= 2; x++) {
			let point = center + vec2i(x, y);
			let pair = intensities(point);
			let dx = intensities(point + vec2i(1, 0)) - intensities(point - vec2i(1, 0));
			let dy = intensities(point + vec2i(0, 1)) - intensities(point - vec2i(0, 1));
			let gx = (dx.x + dx.y) * 0.25;
			let gy = (dy.x + dy.y) * 0.25;
			let dt = pair.y - pair.x;
			xx += gx * gx / 25.0;
			xy += gx * gy / 25.0;
			yy += gy * gy / 25.0;
			xt += gx * dt / 25.0;
			yt += gy * dt / 25.0;
			tt += dt * dt / 25.0;
		}
	}
	let determinant = xx * yy - xy * xy;
	let eigenvalue = 0.5 * (xx + yy - sqrt(max(0.0, (xx - yy) * (xx - yy) + 4.0 * xy * xy)));
	if (determinant <= 1e-12 || eigenvalue <= params.confidence) {
		return vec2f(0.0);
	}
	let velocity = vec2f(xy * yt - yy * xt, xy * xt - xx * yt) / determinant;
	// Reject estimates outside this small-motion model, rather than emit a large unstable warp.
	if (length(velocity) > 2.0) {
		return vec2f(0.0);
	}
	let residual = max(0.0, tt + 2.0 * dot(velocity, vec2f(xt, yt))
		+ xx * velocity.x * velocity.x + 2.0 * xy * velocity.x * velocity.y + yy * velocity.y * velocity.y);
	let confidence = smoothstep(params.confidence, params.confidence * 4.0, eigenvalue) * exp(-residual / 0.0025);
	// Shared vector coordinates per second: R rightward, G upward, two units across each axis.
	return velocity * params.texelSize * vec2f(2.0, -2.0) / params.seconds * confidence;
}

@fragment
fn output(@location(0) uv: vec2f) -> @location(0) vec2f {
	let center = texCoords(uv);
	var value = vec2f(0.0);
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let weight = select(1.0, 2.0, x == 0) * select(1.0, 2.0, y == 0);
			value += textureSampleLevel(flow, linearSampler,
				center + vec2f(f32(x), f32(y)) * params.texelSize * params.smoothing, 0.0).rg * weight;
		}
	}
	return value * (params.strength / 16.0);
}
