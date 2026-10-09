import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPerson, normName } from '../js/text.js';

test('normPerson ignores academic titles, hamza and spacing', () => {
  const same = ['د. احمد الراوي', 'د.أحمد الراوي', 'م.د احمد  الراوي', 'أ.د. احمد الراوي', 'الدكتور احمد الراوي', 'احمد الراوي'];
  for (const n of same) assert.equal(normPerson(n), normPerson(same[0]), n);
  assert.notEqual(normPerson('دلال حسن'), normPerson('لال حسن'));
  assert.equal(normPerson('م.م خلدون'), 'خلدون');
  assert.notEqual(normPerson('د. احمد سالم'), normPerson('د. احمد سعدون'));
});

test('normName treats alef and taa marbuta variants as equal', () => {
  assert.equal(normName('كلية طب الاسنان'), normName('كلية طب الأسنان'));
});
