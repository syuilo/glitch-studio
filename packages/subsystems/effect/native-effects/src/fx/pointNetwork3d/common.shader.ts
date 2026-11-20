import code from './common.wgsl?raw';
import { MAX_NEIGHBOR_COUNT } from './constants.ts';

export default `const NEIGHBOR_CAPACITY = ${MAX_NEIGHBOR_COUNT}u;\n` + code;
