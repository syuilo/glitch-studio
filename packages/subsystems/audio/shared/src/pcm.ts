export type StereoPcm = [Float32Array, Float32Array];

/** timeは素材内の秒。デコーダーのブロック境界は音声の切れ目を意味しない。 */
export type DecodedPcmBlock = { time: number; rate: number; channels: StereoPcm };
