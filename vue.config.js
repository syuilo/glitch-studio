module.exports = {
	parallel: true,
	chainWebpack: (config) => {
		config.module.rule('worker')
			.test(/workers\/*\.js$/i)
			.use('worker-loader')
			.loader('worker-loader');
	},
};
