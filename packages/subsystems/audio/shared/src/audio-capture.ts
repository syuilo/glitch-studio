/** 取得元に依存しないキャプチャPCM。bufferはチャンネルごとにframeCount個のサンプルを持つ。 */
export type AudioChunk = {
	type: 'samples';
	generation: number;
	startFrame: number;
	sampleRate: number;
	channelCount: number;
	frameCount: number;
	buffer: ArrayBuffer;
};

export type AudioCaptureMessage = AudioChunk | {
	type: 'reset';
	generation: number;
};
