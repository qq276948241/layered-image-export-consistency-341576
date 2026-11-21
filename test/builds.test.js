import { createRequire } from 'node:module';
import test from 'ava';
import { FakeImage, fakeImpl, decodeDataURI } from './helpers/fakes.js';
import * as px from './fixtures/pixels.js';

// Both published builds must accept the same options and produce the same
// output as the source module.
const require = createRequire(import.meta.url);
const umd = require('../dist/index.cjs');
const esm = (await import('../dist/index.mjs')).default;

const builds = [
	['umd', umd],
	['esm', esm]
];

for (const [name, mergeImages] of builds) {
	test.serial(`the ${name} build composes layers with the standard options`, async t => {
		FakeImage.reset();
		FakeImage.register('red2x2', px.red2x2);
		FakeImage.register('blueHalf2x2', px.blueHalfAlpha2x2);

		const b64 = await mergeImages(['red2x2', { src: 'blueHalf2x2', x: 0, y: 0 }], {
			...fakeImpl,
			width: 2,
			height: 2,
			format: 'image/png',
			quality: 0.92
		});
		const result = decodeDataURI(b64);
		t.is(result.width, 2);
		t.is(result.height, 2);
		t.deepEqual(Array.from(result.data), px.blueHalfOverRed2x2.pixels);
	});
}

test('both builds expose the same default export contract', t => {
	t.is(typeof umd, 'function');
	t.is(typeof esm, 'function');
});
