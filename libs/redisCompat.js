/*
node-redis 3 style client on top of node-redis 6.

The portal was written against node-redis 3: callback commands
(client.hset(key, field, value, cb)), multi with an array of commands
(client.multi([["hset", ...], ...]).exec(cb)), and v3's raw replies. From
v4 on node-redis is promise-based and reshapes many replies (HGETALL ->
object, HSCAN -> {cursor, entries}, ...). This adapter keeps the v3
behaviour so the rest of the code is unchanged:

- every command is sent raw (sendCommand), so replies are what Redis
  returns - as v3 did - except HGETALL, which v3 turned into an object,
  or null for a missing/empty hash;
- arguments are flattened like v3: nested arrays are spread, an object
  argument (hmset/hset) becomes field/value pairs, numbers become strings;
- createClient({host, port, password}) connects at once and reconnects
  with backoff; 'ready', 'error', 'end', 'reconnecting' events are the
  client's own. Commands issued while connecting are queued.
*/
var redis = require("redis");

function flattenArgs(args, out) {
  out = out || [];
  args.forEach(function (a) {
    if (Array.isArray(a)) {
      flattenArgs(a, out);
    } else if (Buffer.isBuffer(a)) {
      out.push(a);
    } else if (a !== null && typeof a === "object") {
      Object.keys(a).forEach(function (k) {
        out.push(k, String(a[k]));
      });
    } else {
      out.push(String(a));
    }
  });
  return out;
}

function v3Reply(command, reply) {
  if (command === "hgetall") {
    if (Array.isArray(reply)) {
      if (reply.length === 0) return null;
      var obj = {};
      for (var i = 0; i < reply.length; i += 2) obj[reply[i]] = reply[i + 1];
      return obj;
    }
    if (reply && typeof reply === "object" && Object.keys(reply).length === 0) return null;
  }
  return reply;
}

function splitCallback(args) {
  var cb = typeof args[args.length - 1] === "function" ? args.pop() : null;
  return cb;
}

exports.createClient = function (options) {
  options = options || {};
  var client = redis.createClient({
    socket: {
      host: options.host || "127.0.0.1",
      port: options.port || 6379,
      reconnectStrategy: function (retries) {
        return Math.min(retries * 200, 5000);
      },
    },
    password: options.password ? options.password : undefined,
    // node-redis 3 always spoke RESP2; RESP3 changes reply shapes
    // (e.g. WITHSCORES pairs, maps)
    RESP: 2,
  });

  // Errors are reported through the 'error' event (callers listen to it);
  // without a listener node-redis would throw, as v3 did.
  client.connect().catch(function () {});

  function send(command, args, cb) {
    client
      .sendCommand([command.toUpperCase()].concat(flattenArgs(args)))
      .then(function (reply) {
        if (cb) cb(null, v3Reply(command, reply));
      })
      .catch(function (err) {
        if (cb) cb(err);
      });
    return true;
  }

  function multi(commands) {
    var queue = (commands || []).map(function (c) {
      return { command: String(c[0]).toLowerCase(), args: c.slice(1) };
    });
    var m = {
      exec: function (cb) {
        var tx = client.multi();
        queue.forEach(function (q) {
          tx.addCommand([q.command.toUpperCase()].concat(flattenArgs(q.args)));
        });
        tx.exec()
          .then(function (replies) {
            if (cb) {
              cb(
                null,
                replies.map(function (r, i) {
                  return v3Reply(queue[i].command, r);
                })
              );
            }
          })
          .catch(function (err) {
            if (cb) cb(err, err && err.replies);
          });
      },
    };
    // Chained form: client.multi().hset(...).sadd(...).exec(cb)
    var proxy = new Proxy(m, {
      get: function (target, prop) {
        if (prop in target || typeof prop !== "string") return target[prop];
        return function () {
          queue.push({ command: prop.toLowerCase(), args: Array.prototype.slice.call(arguments) });
          return proxy;
        };
      },
    });
    return proxy;
  }

  var api = {
    on: function () {
      client.on.apply(client, arguments);
      return api;
    },
    once: function () {
      client.once.apply(client, arguments);
      return api;
    },
    multi: multi,
    quit: function (cb) {
      var close = client.close ? client.close.bind(client) : client.quit.bind(client);
      Promise.resolve()
        .then(close)
        .then(function () {
          if (cb) cb(null, "OK");
        })
        .catch(function (err) {
          if (cb) cb(err);
        });
    },
    get connected() {
      return client.isReady;
    },
    _client: client,
  };

  // Any other property is a Redis command: client.hset(...args, cb)
  return new Proxy(api, {
    get: function (target, prop) {
      if (prop in target || typeof prop !== "string") return target[prop];
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var cb = splitCallback(args);
        return send(prop.toLowerCase(), args, cb);
      };
    },
  });
};
