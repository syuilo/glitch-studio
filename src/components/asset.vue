<template>
<div class="asset-component">
	{{ asset.name }}
</div>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
	props: {
		asset: {
			type: Object,
			required: true
		},
	},
});
</script>

<style scoped lang="scss">
.asset-component {
}
</style>
