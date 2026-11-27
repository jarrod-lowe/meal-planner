// CloudFront Function (cloudfront-js-2.0, viewer request) on the default
// behaviour: SPA routing (DESIGN §8.1). A path whose last segment has no file
// extension is an app route, so it gets the SPA's index.html. Files (anything
// with an extension) are served as they are. `/api/*` is a separate
// behaviour, but is left alone here too, in case that ever changes.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.startsWith('/api/')) {
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
