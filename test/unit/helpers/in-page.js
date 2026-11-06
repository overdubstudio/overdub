// The page's `window.overdub`, for checks that ran as page.evaluate(() => window.overdub...) and touch no DOM: the same
// function bodies run here against a fake app, so a moved check keeps the lines it had. A body that reaches for
// `document` fails loudly, which is the signal that it belongs in the browser. Not a test (the unit glob is *.test.js).
//
//   const { E, page } = inPage(app);   // E(fn, arg) === page.evaluate(fn, arg)
export function inPage(app) {
  globalThis.window = { overdub: app };
  const E = async (fn, arg) => fn(arg);
  return { E, page: { evaluate: E } };
}

// Put the global back when the test is done.
export function leavePage() {
  delete globalThis.window;
}
