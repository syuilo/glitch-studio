<template>
<div class="layers">
	<header>
		<select @change="$event => { addFx($event.target.value); $event.target.value = ''; }">
			<option value="" selected disabled>Add FX...</option>
			<option value="tear">Tear</option>
			<option value="tearBulk">Bulk tear</option>
			<option value="blur">Blur</option>
		</select>
	</header>
	<div class="layers">
		<XLayer v-for="layer in $store.state.layers" :layer="layer" :key="layer.id"/>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import XLayer from './layer.vue';

export default Vue.extend({
	components: {
		XLayer
	},

	methods: {
		addFx(fx) {
			if (fx == '') return;
			this.$store.commit('addLayer', { fx: fx });
		}
	}
});
</script>

<style scoped lang="scss">
.layers {
	> .layers {
		> * {
			margin: 4px;
		}
	}
}
</style>
