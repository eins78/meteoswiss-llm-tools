// Preload for the persistent promptfoo viewer (see start-viewer.sh): force every TCP server in the
// process to listen on 127.0.0.1. `promptfoo view` has no host flag and binds all interfaces, and
// its API is unauthenticated, so without this the viewer is reachable from the local network.
// `tailscale serve` proxies to 127.0.0.1:<port>, so tailnet access is unaffected.
// Loaded with NODE_OPTIONS=--require <this file>.
'use strict';
const net = require('node:net');

const LOOPBACK = '127.0.0.1';
const listen = net.Server.prototype.listen;

net.Server.prototype.listen = function (...args) {
  const first = args[0];
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    // listen(port[, host][, backlog][, callback])
    if (args.length === 1 || typeof args[1] === 'function' || typeof args[1] === 'number') {
      args.splice(1, 0, LOOPBACK);
    } else if (typeof args[1] === 'string') {
      args[1] = LOOPBACK;
    }
  } else if (first && typeof first === 'object' && first.port !== undefined && !first.path) {
    // listen({ port, host, ... })
    args[0] = { ...first, host: LOOPBACK };
  }
  return listen.apply(this, args);
};
