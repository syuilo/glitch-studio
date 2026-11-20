import { MAX_ZOOM_BLUR_SAMPLES } from './sampling.ts';
import shaderCode from './shader.wgsl?raw';

export default `const MAX_ZOOM_BLUR_SAMPLES = ${MAX_ZOOM_BLUR_SAMPLES}u;\n` + shaderCode;
