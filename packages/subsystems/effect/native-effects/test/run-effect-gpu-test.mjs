import { runEffectInChrome } from '../tools/run-effect-in-chrome.mjs';

export function runEffectGpuTest(entry, functionName, timeout = 45000, args = []) {
	return runEffectInChrome(entry, functionName, { chromePath: process.env.CHROME_PATH, timeout, args });
}
