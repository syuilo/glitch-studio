struct Uniforms {
	width: u32,
	height: u32,
	length: u32,
	lines: u32,
	vertical: u32,
	descending: u32,
	run: u32,
	threshold: f32,
	shadow: u32,
	lineOffset: u32,
};

struct Pixel {
	segment: u32,
	luminance: f32,
	index: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> input: array<Pixel>;
@group(0) @binding(3) var<storage, read_write> output: array<Pixel>;

fn coordinates(index: u32, line: u32) -> vec2u {
	return select(vec2u(index, line), vec2u(line, index), uniforms.vertical != 0u);
}

fn samplePixel(index: u32, line: u32) -> vec4f {
	// 出力画素の中心にfit/wrapを適用した画像をソートする。
	// 閾値判定と並べ替え後の出力で同じ関数・同じ座標を使い、値の不一致を防ぐ。
	let uv = (vec2f(coordinates(index, line)) + 0.5) / vec2f(f32(uniforms.width), f32(uniforms.height));
	return read_input((uv * 2.0 - 1.0) * vec2f(1.0, -1.0));
}

// One linear scan per line labels runs. Pixels outside the selected range get singleton
// segments, so sorting never moves pixels across a threshold boundary.
@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
	let line = id.x;
	if (line >= uniforms.lines) { return; }
	var segment = 0u;
	for (var i = 0u; i < uniforms.length; i++) {
		let color = samplePixel(i, line + uniforms.lineOffset);
		let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
		let boundary = select((luminance < uniforms.threshold), (luminance > uniforms.threshold), uniforms.shadow != 0u);
		if (boundary) { segment++; }
		output[line * uniforms.length + i] = Pixel(segment, luminance, i);
		if (boundary) { segment++; }
	}
}

fn less(a: Pixel, b: Pixel) -> bool {
	if (a.segment != b.segment) { return a.segment < b.segment; }
	if (a.luminance != b.luminance) {
		return select((a.luminance < b.luminance), (a.luminance > b.luminance), uniforms.descending != 0u);
	}
	return a.index < b.index;
}

// Parallel merge: each pixel binary-searches the opposite sorted run for its
// destination. Source index breaks ties, giving unique writes and stable sorting.
// O(log(length)) dispatches, O(log²(length)) work per pixel, no CPU readback.
@compute @workgroup_size(64)
fn merge(@builtin(global_invocation_id) id: vec3u) {
	let i = id.x;
	let line = id.y;
	if (i >= uniforms.length) { return; }
	let base = line * uniforms.length;
	let pair = (i / (2u * uniforms.run)) * (2u * uniforms.run);
	let middle = min(pair + uniforms.run, uniforms.length);
	let end = min(pair + 2u * uniforms.run, uniforms.length);
	let left = i < middle;
	let ownStart = select(middle, pair, left);
	let otherStart = select(pair, middle, left);
	var low = otherStart;
	var high = select(middle, end, left);
	let pixel = input[base + i];
	while (low < high) {
		let mid = low + (high - low) / 2u;
		if (less(input[base + mid], pixel)) {
			low = mid + 1u;
		} else {
			high = mid;
		}
	}
	output[base + pair + (i - ownStart) + (low - otherStart)] = pixel;
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let xy = vec2u(position.xy);
	let index = select(xy.x, xy.y, uniforms.vertical != 0u);
	let line = select(xy.y, xy.x, uniforms.vertical != 0u);
	return samplePixel(input[(line - uniforms.lineOffset) * uniforms.length + index].index, line);
}
