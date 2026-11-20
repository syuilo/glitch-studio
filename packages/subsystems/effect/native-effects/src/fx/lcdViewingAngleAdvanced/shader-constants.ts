import { SPECTRAL_SAMPLE_COUNT } from '../../optics/spectral-samples.ts';
import { RESPONSE_SAMPLE_COUNT, LIQUID_CRYSTAL_LAYER_COUNT } from './optical-data.ts';

// 解析対象の応答・光学パスと、実行時に入力bindingを追加する最終パスで定数を揃える。
export const shaderConstants = `const RESPONSE_SAMPLE_COUNT = ${RESPONSE_SAMPLE_COUNT}u;
const SPECTRAL_SAMPLE_COUNT = ${SPECTRAL_SAMPLE_COUNT}u;
const LIQUID_CRYSTAL_LAYER_COUNT = ${LIQUID_CRYSTAL_LAYER_COUNT}u;
`;
