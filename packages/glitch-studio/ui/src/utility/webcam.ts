import { i18n } from '@/i18n.ts';
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
					title: i18n.ts._Webcam.AccessFailed,
					text: i18n.ts._Webcam.PermissionDenied,
				});
			} else {
				ui.alert({
					type: 'error',
					title: i18n.ts._Webcam.AccessFailed,
					text: err.message,
				});
			}
			reject(err);
		});
	});
}
