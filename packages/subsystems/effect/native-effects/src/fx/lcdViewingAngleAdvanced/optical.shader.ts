import { shaderConstants } from './shader-constants.ts';
import opticalShaderCode from './optics.wgsl?raw';

export default shaderConstants + opticalShaderCode;
