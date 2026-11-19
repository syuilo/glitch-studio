@group(0) @binding(1) var<storage, read> objects: array<OpticalObject>;
@group(0) @binding(2) var<storage, read> roots: array<PrimaryRay>;
@group(0) @binding(3) var<storage, read_write> segments: array<OpticalSegment>;

struct RayState {
	origin: vec2f,
	direction: vec2f,
	power: f32,
	medium: i32,
	interactions: u32,
}
struct BoundaryHit {
	position: vec2f,
	object: i32,
}

fn rectangleDistance(point: vec2f, halfExtent: vec2f) -> f32 {
	let q = abs(point) - halfExtent;
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn objectDistance(index: u32, point: vec2f) -> f32 {
	let value = read_sdfs(index, point / settings.halfExtent);
	// 空形状の予約値は矩形で切り抜いても空。NaN/Infから無効な経路も生成しない。
	if (!(abs(value) < 65504.0)) { return 65504.0; }
	if (objects[index].mapping.z != 0.0) {
		return max(value, rectangleDistance(point, settings.halfExtent / objects[index].mapping.xy));
	}
	return value;
}

fn viewportInterval(origin: vec2f, direction: vec2f) -> vec2f {
	// 軸に平行でも0除算・0*Infを生じさせないslab交差。画面外の光源も入射できる。
	var inverse = vec2f(1e20);
	if (abs(direction.x) > 1e-12) { inverse.x = 1.0 / direction.x; }
	if (abs(direction.y) > 1e-12) { inverse.y = 1.0 / direction.y; }
	let first = (-settings.halfExtent - origin) * inverse;
	let second = (settings.halfExtent - origin) * inverse;
	let near = min(first, second);
	let far = max(first, second);
	return vec2f(max(0.0, max(near.x, near.y)), min(far.x, far.y));
}

fn findBoundary(origin: vec2f, direction: vec2f, maximumDistance: f32) -> BoundaryHit {
	var travelled = 0.0;
	var position = origin;
	for (var step = 0u; step < settings.maximumSteps; step++) {
		var nearestDistance = 65504.0;
		var nearestObject = -1;
		for (var index = 0u; index < count_sdfs; index++) {
			let distance = abs(objectDistance(index, position));
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestObject = i32(index);
			}
		}
		if (nearestObject >= 0 && nearestDistance <= settings.boundaryEpsilon) { return BoundaryHit(position, nearestObject); }
		if (travelled >= maximumDistance) { return BoundaryHit(position, -1); }
		// 変形・Boolean後の場が厳密な距離でなくても、一度に大きく進めないようにする。
		// この上限より薄い形状を常に検出する保証はなく、Maximum Trace Stepを小さくして精度を上げる。
		let stride = min(maximumDistance - travelled, min(settings.maximumStep, max(settings.boundaryEpsilon * 0.5, nearestDistance * 0.8)));
		let next = position + direction * stride;
		var firstCrossing = 2.0;
		var crossedObject = -1;
		for (var index = 0u; index < count_sdfs; index++) {
			let startDistance = objectDistance(index, position);
			let endDistance = objectDistance(index, next);
			if ((startDistance < 0.0) != (endDistance < 0.0)) {
				var low = 0.0;
				var high = 1.0;
				for (var refinement = 0u; refinement < 12u; refinement++) {
					let middle = (low + high) * 0.5;
					if ((objectDistance(index, mix(position, next, middle)) < 0.0) == (startDistance < 0.0)) { low = middle; } else { high = middle; }
				}
				let crossing = (low + high) * 0.5;
				if (crossing < firstCrossing) { firstCrossing = crossing; crossedObject = i32(index); }
			}
		}
		if (crossedObject >= 0) { return BoundaryHit(mix(position, next, firstCrossing), crossedObject); }
		position = next;
		travelled += stride;
	}
	// 反復上限に達したら、未確認の区間を勝手に空間として描かず、到達した位置で打ち切る。
	return BoundaryHit(position, -1);
}

fn mediumIor(medium: i32, wavelengthNm: f32) -> f32 {
	if (medium < 0) { return settings.exteriorIor; }
	let material = objects[u32(medium)].material;
	let wavelength = wavelengthNm * 0.001;
	return clamp(material.y + material.z * (1.0 / (wavelength * wavelength) - 1.0 / (0.55 * 0.55)), 1.0, 10.0);
}

fn absorptionCoefficient(medium: i32, wavelength: f32) -> f32 {
	if (medium < 0) { return 0.0; }
	let absorption = objects[u32(medium)].absorption.xyz;
	// 3波長の係数を区分線形で補間する。光源RGBから分光分布を復元する処理ではない。
	if (wavelength < 550.0) { return mix(absorption.z, absorption.y, clamp((wavelength - 450.0) / 100.0, 0.0, 1.0)); }
	return mix(absorption.y, absorption.x, clamp((wavelength - 550.0) / 100.0, 0.0, 1.0));
}

@compute @workgroup_size(64)
fn traceOptics(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= settings.rootCount) { return; }
	let root = roots[id.x];
	let interval = viewportInterval(root.originDirection.xy, root.originDirection.zw);
	if (interval.y <= interval.x) { return; }
	let origin = root.originDirection.xy + root.originDirection.zw * interval.x;
	var initialMedium = -1;
	for (var index = 0u; index < count_sdfs; index++) {
		if (objectDistance(index, origin) < 0.0) {
			if (objects[index].material.x != 0.0) { return; }
			initialMedium = i32(index);
			break;
		}
	}
	// 一次光線ごとに連続した固定領域を所有する。atomicでの予約順に依存させず、
	// 同じ入力では分岐の打ち切りも描画順も一定にする。余りは先頭から1区間ずつ配分する。
	let quota = settings.pathBudget / settings.rootCount;
	let remainder = settings.pathBudget % settings.rootCount;
	let firstSegment = id.x * quota + min(id.x, remainder);
	let segmentCount = quota + select(0u, 1u, id.x < remainder);
	// 深さ優先探索の保留枝は最大深さ+1個。Max Interactionsの上限32と対応する。
	var pending: array<RayState, 33>;
	pending[0] = RayState(origin, root.originDirection.zw, 1.0, initialMedium, 0u);
	var pendingCount = 1u;
	var written = 0u;
	loop {
		if (pendingCount == 0u || written >= segmentCount) { break; }
		pendingCount--;
		let ray = pending[pendingCount];
		if (ray.power <= 0.0 || ray.power < settings.minimumRelativePower) { continue; }
		let bounds = viewportInterval(ray.origin, ray.direction);
		if (bounds.y <= 0.0) { continue; }
		let hit = findBoundary(ray.origin, ray.direction, bounds.y);
		let distance = length(hit.position - ray.origin);
		let sigma = absorptionCoefficient(ray.medium, root.spectrum.x);
		segments[firstSegment + written] = OpticalSegment(vec4f(ray.origin, hit.position), root.response * (root.spectrum.y * ray.power), vec4f(sigma, 0.0, 0.0, 0.0));
		written++;
		if (hit.object < 0 || ray.interactions >= settings.maxInteractions) { continue; }
		let index = u32(hit.object);
		let material = objects[index].material;
		if (material.x == 2.0) { continue; }
		let h = objects[index].absorption.w;
		let gradient = vec2f(
			objectDistance(index, hit.position + vec2f(h, 0.0)) - objectDistance(index, hit.position - vec2f(h, 0.0)),
			objectDistance(index, hit.position + vec2f(0.0, h)) - objectDistance(index, hit.position - vec2f(0.0, h)));
		if (dot(gradient, gradient) < 1e-20) { continue; }
		var normal = normalize(gradient);
		if (dot(normal, ray.direction) > 0.0) { normal = -normal; }
		let power = ray.power * exp(-sigma * distance);
		let offset = normal * settings.boundaryEpsilon * 4.0;
		let reflectedDirection = reflect(ray.direction, normal);
		if (material.x == 1.0) {
			pending[pendingCount] = RayState(hit.position + offset, reflectedDirection, power * material.w, ray.medium, ray.interactions + 1u);
			pendingCount++;
			continue;
		}
		let targetMedium = select(hit.object, -1, hit.object == ray.medium);
		let incidentIor = mediumIor(ray.medium, root.spectrum.x);
		let targetIor = mediumIor(targetMedium, root.spectrum.x);
		let ratio = incidentIor / targetIor;
		let incidentCosine = clamp(-dot(normal, ray.direction), 0.0, 1.0);
		let transmittedSineSquared = ratio * ratio * max(0.0, 1.0 - incidentCosine * incidentCosine);
		var reflectance = 1.0;
		var transmittedDirection = vec2f(0.0);
		if (transmittedSineSquared < 1.0) {
			let transmittedCosine = sqrt(max(0.0, 1.0 - transmittedSineSquared));
			transmittedDirection = normalize(ratio * ray.direction + (ratio * incidentCosine - transmittedCosine) * normal);
			if (abs(incidentIor - targetIor) < 1e-6) {
				reflectance = 0.0;
			} else {
				let s = (incidentIor * incidentCosine - targetIor * transmittedCosine) / max(1e-12, incidentIor * incidentCosine + targetIor * transmittedCosine);
				let p = (targetIor * incidentCosine - incidentIor * transmittedCosine) / max(1e-12, targetIor * incidentCosine + incidentIor * transmittedCosine);
				reflectance = clamp((s * s + p * p) * 0.5, 0.0, 1.0);
			}
		}
		let reflected = RayState(hit.position + offset, reflectedDirection, power * reflectance, ray.medium, ray.interactions + 1u);
		let transmitted = RayState(hit.position - offset, transmittedDirection, power * (1.0 - reflectance), targetMedium, ray.interactions + 1u);
		// 強い枝を先に処理する。枝ごとの光量は保存し、予算で省略した光を残りへ再分配しない。
		let transmitFirst = transmitted.power >= reflected.power;
		if (transmitFirst) {
			if (reflected.power > 0.0 && reflected.power >= settings.minimumRelativePower) { pending[pendingCount] = reflected; pendingCount++; }
			if (transmitted.power > 0.0 && transmitted.power >= settings.minimumRelativePower) { pending[pendingCount] = transmitted; pendingCount++; }
		} else {
			if (transmitted.power > 0.0 && transmitted.power >= settings.minimumRelativePower) { pending[pendingCount] = transmitted; pendingCount++; }
			if (reflected.power > 0.0 && reflected.power >= settings.minimumRelativePower) { pending[pendingCount] = reflected; pendingCount++; }
		}
	}
}
