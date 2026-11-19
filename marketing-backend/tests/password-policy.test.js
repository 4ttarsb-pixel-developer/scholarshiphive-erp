const test=require('node:test');
const assert=require('node:assert/strict');
const {passwordError}=require('../src/utils/password-policy');

test('8-character strong password accepted',()=>{
  assert.equal(passwordError('Abcdef1!'),null);
  assert.equal(passwordError('AdminDemo!2026'),null);
});
test('minimum length, uppercase, digit and special character enforced',()=>{
  assert.match(passwordError('Abc1!'),/8-128/);
  assert.match(passwordError('abcdef1!'),/uppercase/);
  assert.match(passwordError('Abcdefg!'),/digit/);
  assert.match(passwordError('Abcdef12'),/special/);
  assert.match(passwordError('Abcdef 1'),/special/);
});
