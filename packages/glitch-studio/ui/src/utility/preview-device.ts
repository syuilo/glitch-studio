export const defaultPreviewDeviceId = 'default';

export function previewDeviceConstraint(deviceId: string): true | MediaTrackConstraints {
	return deviceId === defaultPreviewDeviceId ? true : { deviceId: { exact: deviceId } };
}

export async function openPreviewDevice(constraints: MediaStreamConstraints, signal: AbortSignal) {
	signal.throwIfAborted();
	const stream = await navigator.mediaDevices.getUserMedia(constraints);
	const stopTracks = () => { for (const track of stream.getTracks()) track.stop(); };
	// 許可ダイアログを取り消せない場合も、切替や終了の後に得た機器はすぐに解放する。
	if (signal.aborted) {
		stopTracks();
		return null;
	}
	signal.addEventListener('abort', stopTracks, { once: true });
	return stream;
}
