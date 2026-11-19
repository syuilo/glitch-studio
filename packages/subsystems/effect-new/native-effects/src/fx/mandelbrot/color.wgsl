fn colorMandelbrotSample(orbit: MandelbrotOrbit, position: vec2f) -> vec4f {
	if (orbit.escapedMask == 0.0) {
		return read_unescapedColor(position);
	}
	var rampPosition = orbit.escapeIterations / uniforms.iterationColorPeriod;
	if (uniforms.coloringMethod == 1u) {
		rampPosition = orbit.smoothIterations / uniforms.iterationColorPeriod;
	} else if (uniforms.coloringMethod == 2u) {
		rampPosition = orbit.triangleInequalityAverage * uniforms.triangleColorDensity;
	}
	// 色と透明度はRampだけで決め、数値出力へは密度・位相を適用しない。
	// evaluateColorRampとShaderInputの色は既に乗算済みで、alphaを再乗算しない。
	return evaluateColorRamp(fract(rampPosition + uniforms.colorPhase));
}
