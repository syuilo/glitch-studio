<template>
<div class="dialog-componet">
	<div class="_gs-container">
		<slot></slot>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({});
</script>

<style scoped lang="scss">
.dialog-componet {
	position: fixed;
	z-index: 1000;
	top: 35px;
	left: 8px;
	width: calc(100% - (8px * 2));
	height: calc(100% - 43px);
	background: rgba(0, 0, 0, 0.1);
	backdrop-filter: blur(4px);
	border-radius: 6px;

	> div {
		position: absolute;
		top: 50%;
		right: 0;
		left: 0;
		width: 300px;
		margin: 0 auto;
		transform: translateY(-50%);
		padding: 32px;
		text-align: center;
		font-size: 14px;
	}
}
</style>
