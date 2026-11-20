@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	return read_input(position);
}
