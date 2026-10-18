/** Only pages served from this machine may follow the book or drive the agent. A browser lets any website open
 *  http://localhost or ws://localhost, so without this check any page could read the book through the server.
 *  A client without an Origin (the terminal chat, scripts, tests) is not a browser page. */
export const localOrigin = (origin) => origin === undefined || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
