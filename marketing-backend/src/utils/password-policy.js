// Shared server-side rule for development account creation.
// Minimum 8 characters; at least one uppercase letter, number, and punctuation symbol.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
function passwordError(value) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return 'Password must be 8-128 characters';
  }
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(value)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9\s]/.test(value)) return 'Password must contain at least one special character';
  return null;
}
module.exports={passwordError,PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH};
