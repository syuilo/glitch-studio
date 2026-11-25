import interpolationCode from '../../gradient-interpolation.wgsl?raw';
import shaderCode from './shader.wgsl?raw';

export default interpolationCode + '\n' + shaderCode;
