export type StereoPcm = [Float32Array, Float32Array];

/** 再生位置・方向と読み出せる素材範囲。呼び出し元のクリップやSceneは知らない。 */
export type AudioPcmReadOptions = {
	playbackRate?: number;
	sourceStartSeconds?: number;
	sourceEndSeconds?: number;
};

/** timeは素材内の秒。デコーダーのブロック境界は音声の切れ目を意味しない。 */
export type DecodedPcmBlock = { time: number; rate: number; channels: StereoPcm };
