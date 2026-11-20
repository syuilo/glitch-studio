struct Uniforms {
	halfExtent: vec2f,
	axis: vec2f,
	pixelSize: f32,
	curlRadius: f32,
	backMode: u32,
	shadowOpacity: f32,
	shadowSoftness: f32,
	shading: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
const PI: f32 = 3.141592653589793;

// origin + axis * t が有限矩形内にあるtの区間。対角方向なのでaxisの両成分は0にならない。
// 紙の材料範囲と画素の範囲に同じ直線を通し、斜めの側辺も含めて被覆を求める。
fn rectangleInterval(origin: vec2f, halfExtent: vec2f) -> vec2f {
	let first = (-halfExtent - origin) / uniforms.axis;
	let second = (halfExtent - origin) / uniforms.axis;
	let lower = min(first, second);
	let upper = max(first, second);
	return vec2f(max(lower.x, lower.y), min(upper.x, upper.y));
}

fn materialPosition(spatialPosition: vec2f, coordinate: f32, materialCoordinate: f32) -> vec2f {
	let position = (spatialPosition + uniforms.axis * (materialCoordinate - coordinate)) / uniforms.halfExtent;
	// 有限の紙の端で反対側の画素を巻き込まない。その内側では接続のFit / Wrap / Filterに従う。
	let limit = vec2f(1.0) - vec2f(uniforms.pixelSize * 0.5) / uniforms.halfExtent;
	return clamp(position, -limit, limit);
}

fn backColor(position: vec2f) -> vec4f {
	if (uniforms.backMode == 1u) { return read_backColor(position); }
	if (uniforms.backMode == 2u) { return read_backInput(position); }
	let front = read_inputA(position);
	let paper = read_backColor(position);
	// 紙色へ70%寄せる。紙色のalphaは染色の強さとし、元のAのalphaを維持する。
	return vec4f(front.rgb * (1.0 - 0.7 * paper.a) + paper.rgb * (0.7 * front.a), front.a);
}

fn renderSlice(spatialPosition: vec2f, coordinate: f32, pixelInterval: vec2f, crease: f32, front: vec4f, background: vec4f) -> vec4f {
	let material = rectangleInterval(spatialPosition, uniforms.halfExtent) + vec2f(coordinate);
	if (material.y <= material.x) { return background; }
	let radius = uniforms.curlRadius;

	// 材料座標uを折り目cまで平面、その先を半円筒、さらに先を裏返った平面へ写す。
	// 円筒はx=c+r*sin(theta), z=r*(1-cos(theta)), theta=(u-c)/r。
	// 各断面の材料区間を先に制限することで、折り返された三角形の側辺が無限に延びない。
	let frontAngles = clamp((material - vec2f(crease)) / radius, vec2f(0.0), vec2f(PI * 0.5));
	let backAngles = clamp((material - vec2f(crease)) / radius, vec2f(PI * 0.5), vec2f(PI));
	let frontCurve = vec2f(crease) + radius * sin(frontAngles);
	let backCurve = vec2f(crease) + radius * max(sin(backAngles.yx), vec2f(0.0));
	let backPlane = vec2f(2.0 * crease + PI * radius) - vec2f(material.y, clamp(crease + PI * radius, material.x, material.y));
	var backStart = material.y + radius;
	if (backAngles.y > backAngles.x) { backStart = backCurve.x; }
	if (backPlane.y > backPlane.x) { backStart = min(backStart, backPlane.x); }

	// 裏面が必ず手前に来る。表裏の重複を除いた区間でAAし、外縁の被覆を二重加算しない。
	let frontPlane = vec2f(material.x, max(material.x, min(min(crease, material.y), backStart)));
	let visibleFrontCurve = vec2f(frontCurve.x, max(frontCurve.x, min(frontCurve.y, backStart)));
	let patches = array<vec2f, 4>(frontPlane, visibleFrontCurve, backCurve, backPlane);
	let pixelWidth = pixelInterval.y - pixelInterval.x;
	var pageColor = vec4f(0.0);
	var pageCoverage = 0.0;
	var pageEnd = material.x;
	for (var index = 0u; index < 4u; index++) {
		let interval = patches[index];
		if (interval.y <= interval.x) { continue; }
		pageEnd = max(pageEnd, interval.y);
		let start = max(pixelInterval.x, interval.x);
		let end = min(pixelInterval.y, interval.y);
		if (end <= start) { continue; }
		let coverage = clamp((interval.y - pixelInterval.x) / pixelWidth, 0.0, 1.0)
			- clamp((interval.x - pixelInterval.x) / pixelWidth, 0.0, 1.0);
		let sampleCoordinate = (start + end) * 0.5;
		var materialCoordinate = sampleCoordinate;
		var angle = 0.0;
		if (index == 1u || index == 2u) {
			angle = asin(clamp((sampleCoordinate - crease) / radius, 0.0, 1.0));
			if (index == 2u) { angle = PI - angle; }
			materialCoordinate = crease + radius * angle;
		} else if (index == 3u) {
			materialCoordinate = 2.0 * crease + PI * radius - sampleCoordinate;
			angle = PI;
		}
		var color = front;
		// 動かない表面は元の画素中心を読む。AA用の断面ごとに再サンプルすると、
		// 進捗0の直後に画像全体がぼけ、端点で連続しなくなる。
		if (index != 0u) {
			let sourcePosition = materialPosition(spatialPosition, coordinate, clamp(materialCoordinate, material.x, material.y));
			if (index >= 2u) { color = backColor(sourcePosition); } else { color = read_inputA(sourcePosition); }
		}
		let lighting = 1.0 - uniforms.shading * 0.45 * (1.0 - abs(cos(angle)));
		pageColor += vec4f(color.rgb * lighting, color.a) * coverage;
		pageCoverage += coverage;
	}

	var shadedBackground = background;
	if (pageCoverage < 1.0 && uniforms.shadowOpacity > 0.0 && pageEnd > material.x) {
		// 紙の外縁からBへ落とす近似影。断面ごとに浮き上がりと残存範囲で減衰させるため、
		// 隅のごく小さな剥がれや最後の細片にも大きな影が突然現れない。
		let tipAngle = clamp((material.y - crease) / radius, 0.0, PI * 0.5);
		let height = radius * (1.0 - cos(tipAngle));
		let reach = max(height * 0.6 + uniforms.shadowSoftness, 0.0000001);
		let fade = smoothstep(0.0, radius, pageEnd - material.x) * height / (radius + uniforms.shadowSoftness);
		let casterPosition = materialPosition(spatialPosition, coordinate, clamp(crease + radius * tipAngle, material.x, material.y));
		let casterAlpha = clamp(read_inputA(casterPosition).a, 0.0, 1.0);
		let shadow = uniforms.shadowOpacity * fade * casterAlpha * (1.0 - smoothstep(pageEnd, pageEnd + reach, coordinate));
		shadedBackground = vec4f(background.rgb * (1.0 - shadow), background.a);
	}
	// alphaではなく紙の面積で置換し、透明なAの下にBを透かさない。HDR・負のRGBも保持する。
	return (pageColor + shadedBackground * max(0.0, 1.0 - pageCoverage)) / max(1.0, pageCoverage);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let progress = clamp(read_progress(position), 0.0, 1.0);
	if (progress <= 0.0) { return read_inputA(position); }
	if (progress >= 1.0) { return read_inputB(position); }
	let spatialPosition = position * uniforms.halfExtent;
	let pageLength = 2.0 * dot(abs(uniforms.axis), uniforms.halfExtent);
	let coordinate = dot(spatialPosition, uniforms.axis) + pageLength * 0.5;
	let crease = mix(pageLength, -uniforms.curlRadius, progress);
	let front = read_inputA(position);
	let background = read_inputB(position);

	// 画素を剥がれ方向へ切った4断面で面積積分を近似する。各断面内は連続した区間AAとし、
	// 薄い裏面を点サンプルで見落とさず、斜めの紙端にも同じ矩形クリップを適用する。
	let tangent = vec2f(-uniforms.axis.y, uniforms.axis.x);
	let halfPixel = uniforms.pixelSize * 0.5;
	let perpendicularExtent = halfPixel * (abs(uniforms.axis.x) + abs(uniforms.axis.y));
	var color = vec4f(0.0);
	var totalWidth = 0.0;
	for (var slice = 0u; slice < 4u; slice++) {
		let offset = tangent * ((f32(slice) + 0.5) * 0.5 - 1.0) * perpendicularExtent;
		let pixelInterval = rectangleInterval(offset, vec2f(halfPixel)) + vec2f(coordinate);
		let width = pixelInterval.y - pixelInterval.x;
		color += renderSlice(spatialPosition + offset, coordinate, pixelInterval, crease, front, background) * width;
		totalWidth += width;
	}
	return color / totalWidth;
}
