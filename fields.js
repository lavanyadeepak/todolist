// Whitelist + validation for every editable task field.
// Keys are DB column names; each coercer returns the value to store or throws HttpError(400).

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);

const str = (max = 500, { required = false, trim = true } = {}) => (v) => {
  v = v == null ? '' : String(v);
  if (trim) v = v.trim();
  if (required && !v.trim()) throw bad('Value is required');
  if (v.length > max) throw bad(`Too long (max ${max})`);
  return v;
};

const int = (min, max, dflt) => (v) => {
  if (v === '' || v == null) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`Must be a whole number ${min}-${max}`);
  return n;
};

const num = () => (v) => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad('Must be a number >= 0');
  return n;
};

const date = () => (v) => {
  if (v === '' || v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Date must be YYYY-MM-DD');
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad('Invalid date');
  return v;
};

const color = () => (v) => {
  if (v === '' || v == null) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Colour must be #rrggbb');
  return v.toLowerCase();
};

const bool = () => (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);

const oneOf = (list) => (v) => {
  if (!list.includes(v)) throw bad(`Must be one of: ${list.join(', ')}`);
  return v;
};

const idList = () => (v) => {
  v = v == null ? '' : String(v).trim();
  if (!/^[\d,\s]*$/.test(v)) throw bad('Use comma separated task IDs');
  return v.split(',').map((s) => s.trim()).filter(Boolean).join(',');
};

const UNITS = ['mins', 'hours', 'days', 'weeks', 'months', 'years'];
const RECUR = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

const FIELDS = {
  title: str(500, { required: true }),
  comments: str(100000, { trim: false }),
  priority: int(0, 10, 5),
  risk: int(0, 10, 0),
  percent_done: int(0, 100, 0),
  status: str(100),
  allocated_to: str(300),
  allocated_by: str(100),
  category: str(300),
  tags: str(300),
  color: color(),
  flagged: bool(),
  locked: bool(),
  start_date: date(),
  due_date: date(),
  done_date: date(),
  time_estimate: num(),
  time_est_units: oneOf(UNITS),
  time_spent: num(),
  time_spent_units: oneOf(UNITS),
  cost: num(),
  depends: idList(),
  file_link: str(1000),
  external_id: str(100),
  version: str(50),
  icon: str(10),
  recur_freq: oneOf(RECUR),
  recur_interval: int(1, 999, 1),
  recur_reuse: bool(),
};

module.exports = { FIELDS, HttpError, UNITS, RECUR };
