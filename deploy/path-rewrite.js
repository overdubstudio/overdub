// CloudFront Function (viewer-request) for overdubstudio.com. The bucket mirrors the repo's served tree
// (site/, app/, docs/), so this maps the public paths onto it the way server/serve.js does locally.
// The first home (overdub.ajsmithhq.com) and www answer with a permanent redirect to the same path on the apex, so
// every link ever shared keeps working. /community/ is the gallery's public path (site/community/; server/serve.js maps
// it too), and /community reaches it by the no-dot rule. The no-dot redirect keeps the query.
// CLOUDFRONT_NAME: whether the distribution's own <id>.cloudfront.net name is served as itself rather than redirected
// home. False here; infra/live publishes it true while the live distribution has no names of its own (before the
// cutover, var.serve_names), so a first deploy can be checked there. Only a distribution's own cloudfront.net name
// reaches it, so the suffix is enough.
var HOME = 'overdubstudio.com';
var CLOUDFRONT_NAME = false;
function query(qs) {
  var out = [];
  for (var k in qs) {
    var v = qs[k];
    if (v.multiValue) v.multiValue.forEach(function (m) { out.push(m.value === '' ? k : k + '=' + m.value); });
    else out.push(v.value === '' ? k : k + '=' + v.value);
  }
  return out.length ? '?' + out.join('&') : '';
}
function handler(event) {
  var r = event.request, u = r.uri, host = r.headers.host && r.headers.host.value;
  if (host && host !== HOME && !(CLOUDFRONT_NAME && /\.cloudfront\.net$/.test(host))) {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: 'https://' + HOME + u + query(r.querystring) }, 'cache-control': { value: 'max-age=86400' } } };
  }
  if (u === '/' || u === '') { r.uri = '/site/index.html'; return r; }
  if (u === '/llms.txt') { r.uri = '/site/llms.txt'; return r; }
  if (u === '/community/') { r.uri = '/site/community/index.html'; return r; }
  if (u.charAt(u.length - 1) === '/') { r.uri = u + 'index.html'; return r; }
  var last = u.substring(u.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: u + '/' + query(r.querystring) }, 'cache-control': { value: 'max-age=3600' } } };
  }
  return r;
}
