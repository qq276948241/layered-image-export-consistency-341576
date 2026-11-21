import buble from '@rollup/plugin-buble';

export default {
	input: 'src/index.js',
	plugins: [
		buble()
	],
	output: [
		{
			file: 'dist/index.cjs',
			format: 'umd',
			name: 'mergeImages',
			exports: 'default',
			sourcemap: true
		},
		{
			file: 'dist/index.mjs',
			format: 'es',
			sourcemap: true
		}
	]
};
