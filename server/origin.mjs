// Only this machine may use the server: it serves the book being translated (whose text and page images must not
// leave), and it can write. A browser lets any website send requests to http://localhost and open ws://localhost, so
// every request is checked before it is acted on — not only whether its response may be read (CORS), since a
// cross-site "simple" POST would still be carried out.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** A page served from this machine. A client without an Origin (the terminal chat, scripts, tests) is not a browser
 *  page, and may do anything a local program can do anyway. */
export const localOrigin = (origin) => origin === undefined || (/^https?:\/\//.test(origin) && LOCAL.test(origin.replace(/^https?:\/\//, "")))

/** A request addressed to this machine by name. A site that points its own domain at 127.0.0.1 (DNS rebinding) makes
 *  the browser think the server is its own, but the request still carries that domain in Host. */
export const localHost = (host) => host !== undefined && LOCAL.test(host)

/** Whether the server may act on a request at all. */
export const fromThisMachine = (req) => localHost(req.headers.host) && localOrigin(req.headers.origin)

/** CORS for a request that passed: the page's own origin, never "*". */
export const corsHeaders = (origin) => (origin ? { "access-control-allow-origin": origin, vary: "origin" } : {})
