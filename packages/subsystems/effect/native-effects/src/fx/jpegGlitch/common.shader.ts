import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import commonShaderCode from './common.wgsl?raw';

export default colorSpaceShaderCode + '\n' + commonShaderCode;
