type PointerPosition = Readonly<{ x: number; y: number }>;
const MAX_PENDING_SEGMENTS = 128;

export type PointerStrokeSegment = {
	readonly start: PointerPosition;
	readonly end: PointerPosition;
	readonly startTime: number;
	readonly endTime: number;
};

/** 描画間の移動を内容時刻（秒）付きで保持する。途切れた軌跡の前後は接続しない。 */
export class PointerStrokeInput {
	private previous: { pointerId: number; position: PointerPosition; time: number } | null = null;
	private segments: PointerStrokeSegment[] = [];

	public sample(pointerId: number, position: PointerPosition, time: number) {
		const previous = this.previous;
		this.previous = { pointerId, position, time };
		if (previous?.pointerId !== pointerId || (previous.position.x === position.x && previous.position.y === position.y)) return;
		// Workerが描画待ちの間も最新の軌跡を保持し、長時間の停止で入力が無制限に溜まるのを防ぐ。
		if (this.segments.length === MAX_PENDING_SEGMENTS) this.segments.shift();
		this.segments.push({ start: previous.position, end: position, startTime: previous.time, endTime: time });
	}

	public end(pointerId: number) {
		if (this.previous?.pointerId === pointerId) this.previous = null;
	}

	public takeSegments(): readonly PointerStrokeSegment[] {
		const segments = this.segments;
		this.segments = [];
		return segments;
	}

	public reset() {
		this.previous = null;
		this.segments = [];
	}
}
