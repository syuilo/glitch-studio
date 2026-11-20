@fragment
fn fs(@location(0) position: vec2f) -> @location(0) SelectedValue {
	return read_source(position);
}
