// src/context/WSContext.js
// Single persistent WebSocket connection for the entire app.
// Connects on login, stays connected, never re-runs due to callback changes.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WSContext = createContext({ connected: false, subscribe: () => () => {} });

export function WSProvider({ children }) {
  const [connected, setConnected]   = useState(false);
  const wsRef       = useRef(null);
  const timerRef    = useRef(null);
  const mountedRef  = useRef(true);
  const listenersRef = useRef(new Set());   // Set of callback functions

  // Subscribe to messages — returns unsubscribe fn
  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url   = `${proto}//${window.location.host}/ws`;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          setConnected(true);
          // Clear any pending reconnect timer
          if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        };

        ws.onclose = (e) => {
          if (!mountedRef.current) return;
          setConnected(false);
          // Reconnect after 4s unless cleanly closed by logout
          if (e.code !== 1000) {
            timerRef.current = setTimeout(connect, 4000);
          }
        };

        ws.onerror = () => {
          // onclose will fire after onerror — let it handle reconnect
          ws.close();
        };

        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            listenersRef.current.forEach(fn => { try { fn(data); } catch {} });
          } catch {}
        };
      } catch {
        // WebSocket constructor threw (bad URL etc) — retry
        if (mountedRef.current) {
          timerRef.current = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;  // prevent reconnect on unmount
        wsRef.current.close(1000, 'App unmounted');
      }
    };
  }, []); // ← runs ONCE, never re-runs

  return (
    <WSContext.Provider value={{ connected, subscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  return useContext(WSContext);
}

// Convenience hook: subscribe to WS messages in any component
export function useWSMessages(onMessage) {
  const { subscribe } = useWS();
  const fnRef = useRef(onMessage);
  useEffect(() => { fnRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    // Always use the latest fn via ref — no dep array churn
    const unsub = subscribe((msg) => fnRef.current(msg));
    return unsub;
  }, [subscribe]); // subscribe is stable (useCallback + [])
}
