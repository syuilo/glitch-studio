/** GPUのtimestamp queryではなく、フレーム処理中の実経過時間をmsで表す。 */
export type TimelinePreviewFrameTiming = {
	frameDurationMs: number;
	videoSampleWaitMs: number;
	videoUploadCpuMs: number;
	gpuWaitMs: number;
};

export type TimelinePreviewStatistics = {
	sceneId: string | null;
	revision: number;
	frameCount: number;
	average: TimelinePreviewFrameTiming;
	/** 各項目の最大値。同じフレームで記録された値とは限らない。 */
	maximum: TimelinePreviewFrameTiming;
};

function emptyTiming(): TimelinePreviewFrameTiming {
	return {
		frameDurationMs: 0,
		videoSampleWaitMs: 0,
		videoUploadCpuMs: 0,
		gpuWaitMs: 0,
	};
}

/** 通信をフレームごとに増やさず、通知間の全フレームを平均と最大値へ集約する。 */
export class TimelinePreviewStatisticsCollector {
	private statistics: TimelinePreviewStatistics | null = null;
	private total = emptyTiming();

	addFrame(sceneId: string | null, revision: number, timing: TimelinePreviewFrameTiming) {
		if (this.statistics == null || this.statistics.sceneId !== sceneId || this.statistics.revision !== revision) {
			this.clear();
			this.statistics = {
				sceneId,
				revision,
				frameCount: 0,
				average: emptyTiming(),
				maximum: emptyTiming(),
			};
		}
		const statistics = this.statistics;
		statistics.frameCount++;
		for (const key of Object.keys(this.total) as (keyof TimelinePreviewFrameTiming)[]) {
			this.total[key] += timing[key];
			statistics.average[key] = this.total[key] / statistics.frameCount;
			statistics.maximum[key] = Math.max(statistics.maximum[key], timing[key]);
		}
	}

	take(): TimelinePreviewStatistics | null {
		const statistics = this.statistics;
		this.clear();
		return statistics;
	}

	clear() {
		this.statistics = null;
		this.total = emptyTiming();
	}
}
