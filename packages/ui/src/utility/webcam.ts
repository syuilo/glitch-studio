import * as ui from '@/ui.ts';

export function setupWebcam(): Promise<MediaStream> {
	return new Promise((resolve, reject) => {
		navigator.mediaDevices.getUserMedia({
			video: true,
			audio: false,
		}).then(localMediaStream => {
			resolve(localMediaStream);
		}).catch(err => {
			if (err.name === 'PermissionDeniedError') {
				ui.alert({
					type: 'error',
					title: 'Failed to access webcam',
					text: 'denied permission',
				});
			} else {
				ui.alert({
					type: 'error',
					title: 'Failed to access webcam',
					text: err.message,
				});
			}
			reject(err);
		});
	});
}
