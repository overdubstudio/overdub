#!/usr/bin/env node
// A stand-in for the aws CLI, for deploy/headers.sh's checks (tools/community-test.js): it answers the few CloudFront
// calls that script makes from a JSON state file (FAKE_AWS_STATE), logs every call (FAKE_AWS_LOG, one JSON line each)
// and refuses anything else with exit 97, so a call the script shouldn't make fails the check. It answers as AWS does
// where that matters: ETags move on every write, a stale If-Match is refused, and a policy with no custom headers comes
// back without its empty Items.
import fs from 'node:fs';

const args = process.argv.slice(2);
const STATE = process.env.FAKE_AWS_STATE, LOG = process.env.FAKE_AWS_LOG;
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const opt = (k) => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1]; };
const file = (k) => JSON.parse(fs.readFileSync(opt(k).replace(/^file:\/\//, ''), 'utf8'));
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
const out = (v) => process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n');
const fail = (msg, code = 254) => { process.stderr.write(msg + '\n'); process.exit(code); };
fs.appendFileSync(LOG, JSON.stringify(args) + '\n');
st.policies ||= {};
st.n ||= 0;
const etag = () => `E${++st.n}`;
const [svc, cmd] = args;
if (svc !== 'cloudfront') fail('fake aws: no ' + svc, 97);
switch (cmd) {
  case 'list-response-headers-policies': {
    const name = (/Name=='([^']+)'/.exec(opt('--query') || '') || [])[1];
    const id = Object.keys(st.policies).find((k) => st.policies[k].config.Name === name);
    out(id || 'None');
    break;
  }
  case 'create-response-headers-policy': {
    const id = `RHP${Object.keys(st.policies).length + 1}`;
    st.policies[id] = { etag: etag(), config: file('--response-headers-policy-config') };
    save();
    out(id);
    break;
  }
  case 'get-response-headers-policy-config': {
    const p = st.policies[opt('--id')] || fail('NoSuchResponseHeadersPolicy');
    const config = structuredClone(p.config);
    if (config.CustomHeadersConfig && config.CustomHeadersConfig.Quantity === 0) delete config.CustomHeadersConfig.Items;
    out({ ETag: p.etag, ResponseHeadersPolicyConfig: config });
    break;
  }
  case 'update-response-headers-policy': {
    const p = st.policies[opt('--id')] || fail('NoSuchResponseHeadersPolicy');
    if (opt('--if-match') !== p.etag) fail('PreconditionFailed');
    p.config = file('--response-headers-policy-config');
    p.etag = etag();
    save();
    out({ ETag: p.etag });
    break;
  }
  case 'get-distribution-config': {
    const d = st.dists[opt('--id')] || fail('NoSuchDistribution');
    out({ ETag: d.etag, DistributionConfig: d.config });
    break;
  }
  case 'update-distribution': {
    const d = st.dists[opt('--id')] || fail('NoSuchDistribution');
    if (opt('--if-match') !== d.etag) fail('PreconditionFailed');
    d.config = file('--distribution-config');
    d.etag = etag();
    save();
    out({ ETag: d.etag });
    break;
  }
  default: fail('fake aws: no cloudfront ' + cmd, 97);
}
