export function isVideoFrameAvailable(video: HTMLVideoElement): boolean {
	return video.readyState >= video.HAVE_CURRENT_DATA
		&& video.videoWidth > 0
		&& video.videoHeight > 0;
}

export async function playVideoAfterFirstFrameIsReady(video: HTMLVideoElement): Promise<void> {
	const firstFrameReady = waitForVideoFrame(video);
	await Promise.all([
		video.play(),
		firstFrameReady,
	]);
}

export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
	return new Promise((resolve, reject) => {
		// eslint-disable-next-line prefer-const
		let videoFrameCallbackId: number | undefined;

		const cleanup = () => {
			video.removeEventListener('loadeddata', onLoadedData);
			video.removeEventListener('error', onError);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const onLoadedData = () => {
			if (isVideoFrameAvailable(video)) finish();
		};

		const onError = () => {
			cleanup();
			if (videoFrameCallbackId !== undefined) {
				video.cancelVideoFrameCallback(videoFrameCallbackId);
			}
			reject(video.error ?? new Error('Failed to load the video frame.'));
		};

		video.addEventListener('error', onError, { once: true });

		videoFrameCallbackId = video.requestVideoFrameCallback(finish);
	});
}
