import test from 'ava';
import mergeImages from '../src/index.js';
import { fakeImpl } from './helpers/fakes.js';

test('mergeImages is a function', t => {
	t.is(typeof mergeImages, 'function');
});

test('mergeImages returns a Promise', t => {
	t.true(mergeImages([], { ...fakeImpl }) instanceof Promise);
});

test('mergeImages resolves to a string', async t => {
	t.is(typeof await mergeImages([], { ...fakeImpl }), 'string');
});
