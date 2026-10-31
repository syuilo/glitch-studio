export function isVideoFrameAvailable(video: HTMLVideoElement): boolean {
	return video.readyState >= video.HAVE_CURRENT_DATA
		&& video.videoWidth > 0
		&& video.videoHeight > 0;
}
