/* storage.js - proteção do localStorage (fallback em memória). Carregar PRIMEIRO. */
/* MB Persistent Storage patch: protects saves from localStorage errors and keeps a memory fallback. */
( () => {
    const native = window.localStorage;
    const mem = Object.create(null);
    try {
        for (let i = 0; i < native.length; i++) {
            const k = native.key(i);
            if (k)
                mem[k] = native.getItem(k);
        }
    } catch (e) {}
    window.mbStorage = {
        getItem(k) {
            try {
                const v = native.getItem(k);
                if (v !== null) {
                    mem[k] = v;
                    return v;
                }
            } catch (e) {}
            return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
        },
        setItem(k, v) {
            v = String(v);
            mem[k] = v;
            try {
                native.setItem(k, v);
            } catch (e) {
                console.warn('MB storage fallback:', e);
            }
        },
        removeItem(k) {
            delete mem[k];
            try {
                native.removeItem(k);
            } catch (e) {}
        },
        key(i) {
            try {
                return native.key(i) || Object.keys(mem)[i] || null
            } catch (e) {
                return Object.keys(mem)[i] || null
            }
        },
        get length() {
            try {
                return native.length
            } catch (e) {
                return Object.keys(mem).length
            }
        }
    };
    // Make the game's existing localStorage calls use the protected store.
    try {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: window.mbStorage
        });
    } catch (e) {}
}
)();
