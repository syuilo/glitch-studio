// _impl_.tsのModeに対応する。0: Clamp、1: Wrap、2: Ping-pong。
override MODE: u32 = 0u;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) f32 {
	let value = read_input(position);
	let firstBound = read_min(position);
	let secondBound = read_max(position);
	let minimum = min(firstBound, secondBound);
	let maximum = max(firstBound, secondBound);
	let width = maximum - minimum;
	// 上下限の場が交差する画素でも0除算を避け、全方式で同じ値に収束させる。
	if (width == 0.0) { return minimum; }
	if (MODE == 0u) { return clamp(value, minimum, maximum); }
	// 範囲内の値を再計算すると丸め誤差が増えるため、そのまま返す。
	// Wrapだけは上限を下限へ戻す半開区間として扱う。
	if (value >= minimum && value < maximum) { return value; }
	if (MODE == 2u && value == maximum) { return value; }
	let offset = value - minimum;
	if (MODE == 1u) {
		// floorで負の入力も正の周期へ揃える。%の切り捨て剰余では下限を下回ってしまう。
		return minimum + (offset - width * floor(offset / width));
	}
	// 幅の2倍を周期にし、後半を反転して両端で連続する三角波にする。
	let period = width * 2.0;
	let repeated = offset - period * floor(offset / period);
	return minimum + (width - abs(repeated - width));
}
