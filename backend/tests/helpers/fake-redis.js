/**
 * In-memory Redis stand-in shared by the exchange-rate coordinator and the
 * payment-session lock / idempotency tests.
 *
 * Supports GET, SET (EX/PX/NX), DEL and the compare-and-delete EVAL script,
 * both as methods and through sendCommand. Commands run in FIFO order.
 * Expiry follows Date.now(), so it works with vi.useFakeTimers().
 * setFailure() makes later commands reject, which the coordinator uses to
 * exercise its fail-open path.
 */
export function createFakeRedis({ latencyMs = 0 } = {}) {
  const store = new Map(); // key -> { value, expiresAt }
  const calls = [];
  let failWith = null;
  let queue = Promise.resolve();

  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const tick = () => {
    if (latencyMs <= 0) return Promise.resolve();
    queue = queue.then(
      () => new Promise((resolve) => setTimeout(resolve, latencyMs)),
    );
    return queue;
  };

  function setEntry(key, value, { ex, px } = {}) {
    let expiresAt = null;
    if (ex) expiresAt = Date.now() + Number(ex) * 1000;
    if (px) expiresAt = Date.now() + Number(px);
    store.set(key, { value: String(value), expiresAt });
  }

  function isCompareAndDelete(script) {
    const text = String(script);
    return /redis\.call\(['"]get['"], KEYS\[1\]\)/.test(text)
      && /redis\.call\(['"]del['"], KEYS\[1\]\)/.test(text);
  }

  async function run(args, fn) {
    calls.push(args);
    await tick();
    if (failWith) throw failWith;
    return fn();
  }

  return {
    isOpen: true,
    store,
    calls,
    // Payment-session tests read [command, key] pairs. Full sendCommand
    // argument lists still destructure that way.
    commandLog: calls,
    setFailure(error) {
      failWith = error;
    },
    count(cmd) {
      return calls.filter(([name]) => String(name).toUpperCase() === String(cmd).toUpperCase()).length;
    },
    keys(prefix = '') {
      return [...store.keys()].filter((key) => key.startsWith(prefix) && live(key));
    },
    get(key) {
      return run(['GET', key], () => live(key)?.value ?? null);
    },
    set(key, value, opts = {}) {
      return run(['SET', key, value], () => {
        if (opts.NX && live(key)) return null;
        setEntry(key, value, { ex: opts.EX, px: opts.PX });
        return 'OK';
      });
    },
    del(key) {
      return run(['DEL', key], () => (live(key) && store.delete(key) ? 1 : 0));
    },
    sendCommand(args) {
      const [cmd, ...rest] = args;
      return run(args, () => {
        switch (String(cmd).toUpperCase()) {
          case 'GET':
            return live(rest[0])?.value ?? null;
          case 'SET': {
            const [key, value, ...flags] = rest;
            const upper = flags.map((flag) => String(flag).toUpperCase());
            if (upper.includes('NX') && live(key)) return null;
            const pxIdx = upper.indexOf('PX');
            const exIdx = upper.indexOf('EX');
            setEntry(key, value, {
              px: pxIdx >= 0 ? flags[pxIdx + 1] : undefined,
              ex: exIdx >= 0 ? flags[exIdx + 1] : undefined,
            });
            return 'OK';
          }
          case 'DEL':
            return rest.reduce((count, key) => count + (live(key) && store.delete(key) ? 1 : 0), 0);
          case 'EVAL': {
            const [script, numKeys, key, token] = rest;
            if (!isCompareAndDelete(script) || String(numKeys) !== '1') {
              throw new Error('fake-redis: unsupported EVAL script');
            }
            if (live(key)?.value === token) {
              store.delete(key);
              return 1;
            }
            return 0;
          }
          default:
            throw new Error(`fake-redis: unsupported command ${cmd}`);
        }
      });
    },
  };
}
