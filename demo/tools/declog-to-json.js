#!/usr/bin/env node
/**
 * declog-to-json.js — turn a DynamoDB scan of ra-decision-log into the plain
 * DecisionLogEntry[] JSON the dashboard renders.
 *
 * Usage:
 *   aws dynamodb scan --table-name ra-decision-log --output json \
 *     --profile vf-dev-team5 --region us-east-1 \
 *     | node demo/tools/declog-to-json.js > mylog.json
 *   # then: open "demo/web/dashboard.html?src=../mylog.json"  (served statically)
 *
 * No AWS SDK dependency — reads the scan JSON on stdin and unmarshalls it.
 */
function un(v) {
  const [t, val] = Object.entries(v)[0];
  switch (t) {
    case 'S': return val;
    case 'N': return String(val).includes('.') ? parseFloat(val) : parseInt(val, 10);
    case 'BOOL': return val;
    case 'NULL': return null;
    case 'M': return Object.fromEntries(Object.entries(val).map(([k, x]) => [k, un(x)]));
    case 'L': return val.map(un);
    default: return val;
  }
}
let buf = '';
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('end', () => {
  const scan = JSON.parse(buf);
  const items = (scan.Items || []).map((it) =>
    Object.fromEntries(Object.entries(it).map(([k, v]) => [k, un(v)])),
  );
  for (const it of items) delete it.ttl;
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); // newest first
  process.stdout.write(JSON.stringify(items, null, 2));
});
