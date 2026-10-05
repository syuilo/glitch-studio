// 取得元のIDはPlayerに限定しない。将来は音声グラフの出力も登録できる。
export type AudioSourceId = string;

export const projectAudioSourceId: AudioSourceId = 'output:project';

export const playerAudioSourceId = (playerId: string): AudioSourceId => `player:${playerId}`;
