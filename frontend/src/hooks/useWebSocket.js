// src/hooks/useWebSocket.js
// Fixed: onMessage stored in ref to avoid reconnect loop on every render
import { useEffect, useRef, useState } from 'react';

export function useWebSocket(onMessage) {
  const ws          = useRef(null);
  const onMsgRef    = useRef(onMessage);
  const reconnTimer = useRef(null);
  const mounted     = useRef(true);
  const [connected, setConnected] = useState(false);

  // Keep ref current so we never need onMessage in deps
  useEffect(() => { onMsgRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    mounted.current = true;

    function connect() {
      if (!mounted.current) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url   = `${proto}//${window.location.host}/ws`;

      try {
        const socket = new WebSocket(url);
        ws.current = socket;

        socket.onopen = () => {
          if (mounted.current) setConnected(true);
        };

        socket.onclose = () => {
          if (!mounted.current) return;
          setConnected(false);
          // Reconnect after 5 s — only if still mounted
          reconnTimer.current = setTimeout(connect, 5000);
        };

        socket.onerror = () => {
          // onclose fires after onerror, so just close cleanly
          socket.close();
        };

        socket.onmessage = (e) => {
          try { onMsgRef.current(JSON.parse(e.data)); } catch {}
        };
      } catch {}
    }

    connect();

    return () => {
      mounted.current = false;
      clearTimeout(reconnTimer.current);
      if (ws.current) {
        ws.current.onclose = null; // prevent reconnect on unmount
        ws.current.close();
      }
    };
  }, []); // runs once only

  return { connected };
}
