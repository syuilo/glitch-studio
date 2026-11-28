import { MAX_BLOCK_COUNT } from './_def_.ts';
import code from './block-glitch.wgsl?raw';

// 入力画像を描く先頭のインスタンスも、同じ配列に含める。
export default `const BLOCK_INSTANCE_COUNT = ${MAX_BLOCK_COUNT + 1};\n${code}`;
