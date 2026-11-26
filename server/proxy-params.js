'use strict';

/**
 * Values that arrive in a public URL and are pasted into a path on the game-server service.
 *
 * Express decodes route parameters, so "%2F..%2F" in one arrives as "/../", and the HTTP client then
 * resolves the dot segments: the request lands on a different path than the route named. These
 * allow-lists reject anything but the plain id / token shapes before a URL is built.
 */
const SHAPES = {
  serverId: /^\d{1,9}$/,
  modId: /^\d{1,9}$/,
  token: /^[A-Za-z0-9_-]{1,128}$/,
};

/** The value when it has the right shape, otherwise null. */
function safeParam(kind, value) {
  const re = SHAPES[kind];
  if (!re) throw new Error(`unknown parameter kind: ${kind}`);
  return typeof value === 'string' && re.test(value) ? value : null;
}

module.exports = { safeParam };
