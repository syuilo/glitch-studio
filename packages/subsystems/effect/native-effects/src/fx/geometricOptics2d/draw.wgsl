@group(0) @binding(1) var<storage, read> segments: array<OpticalSegment>;

struct SegmentVertex {
	@builtin(position) position: vec4f,
	@location(0) @interpolate(flat) segment: u32,
}

@vertex
fn segmentVertex(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> SegmentVertex {
	let segment = segments[instance];
	let delta = segment.endpoints.zw - segment.endpoints.xy;
	let segmentLength = length(delta);
	if (segment.response.a <= 0.0 || segmentLength < 1e-10) { return SegmentVertex(vec4f(2.0, 2.0, 0.0, 1.0), instance); }
	let corners = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
	let corner = corners[vertex];
	let direction = delta / segmentLength;
	let normal = vec2f(-direction.y, direction.x);
	let width = max(settings.lineWidth, settings.pixelSize);
	let point = segment.endpoints.xy + direction * mix(-settings.pixelSize, segmentLength + settings.pixelSize, corner.x) + normal * corner.y * (width * 0.5 + settings.pixelSize);
	return SegmentVertex(vec4f(point / settings.halfExtent, 0.0, 1.0), instance);
}

@fragment
fn segmentFragment(input: SegmentVertex) -> @location(0) vec4f {
	let segment = segments[input.segment];
	let point = vec2f(input.position.x * settings.pixelSize - settings.halfExtent.x, settings.halfExtent.y - input.position.y * settings.pixelSize);
	let delta = segment.endpoints.zw - segment.endpoints.xy;
	let segmentLength = length(delta);
	let direction = delta / max(segmentLength, 1e-10);
	let relative = point - segment.endpoints.xy;
	let along = dot(relative, direction);
	let across = abs(dot(relative, vec2f(-direction.y, direction.x)));
	let width = max(settings.lineWidth, settings.pixelSize);
	let coverage = clamp(0.5 + (width * 0.5 - across) / settings.pixelSize, 0.0, 1.0)
		* clamp(0.5 + min(along, segmentLength - along) / settings.pixelSize, 0.0, 1.0);
	// 線を太くしても光源の総パワーを増やさず、横断方向の積分を一定にする。
	return segment.response * (settings.accumulationScale * coverage / width * exp(-segment.attenuation.x * clamp(along, 0.0, segmentLength)));
}
