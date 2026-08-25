import { useState, useEffect, useRef } from 'react';

export interface NfcTagEvent {
  uid: string;
  standard?: string;
  atr?: string;
  timestamp: string;
}

export interface UseNfcBridgeOptions {
  wsUrl?: string;
  onTagDetected?: (event: NfcTagEvent) => void;
  onTagRemoved?: () => void;
}

export function useNfcBridge(options?: UseNfcBridgeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [readerName, setReaderName] = useState<string | null>(null);
  const [lastTag, setLastTag] = useState<NfcTagEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    const connect = () => {
      if (isUnmounted) return;
      const url = optionsRef.current?.wsUrl || 'ws://localhost:9191';
      
      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          if (isUnmounted) return;
          setIsConnected(true);
          setError(null);
        };

        ws.onmessage = (event) => {
          if (isUnmounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'BRIDGE_STATUS') {
              if (data.reader) setReaderName(data.reader);
              if (data.lastTag) setLastTag(data.lastTag);
            } else if (data.type === 'READER_CONNECTED') {
              setReaderName(data.reader);
            } else if (data.type === 'READER_DISCONNECTED') {
              setReaderName(null);
            } else if (data.type === 'NFC_TAG_DETECTED') {
              const tagEvent: NfcTagEvent = {
                uid: data.uid,
                standard: data.standard,
                atr: data.atr,
                timestamp: data.timestamp || new Date().toISOString()
              };
              setLastTag(tagEvent);
              if (optionsRef.current?.onTagDetected) {
                optionsRef.current.onTagDetected(tagEvent);
              }
            } else if (data.type === 'NFC_TAG_REMOVED') {
              if (optionsRef.current?.onTagRemoved) {
                optionsRef.current.onTagRemoved();
              }
            }
          } catch (e) {
            console.error('[useNfcBridge] Erro ao processar mensagem do leitor:', e);
          }
        };

        ws.onclose = () => {
          if (isUnmounted) return;
          setIsConnected(false);
          setReaderName(null);
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          if (isUnmounted) return;
          setIsConnected(false);
        };
      } catch (e: any) {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);

  const simulateScan = (uid?: string) => {
    const fakeUid = uid || 'TEST-' + Math.random().toString(16).substring(2, 8).toUpperCase();
    const tagEvent: NfcTagEvent = {
      uid: fakeUid,
      standard: 'Simulado',
      timestamp: new Date().toISOString()
    };
    setLastTag(tagEvent);
    if (optionsRef.current?.onTagDetected) {
      optionsRef.current.onTagDetected(tagEvent);
    }
  };

  return {
    isConnected,
    readerName,
    lastTag,
    error,
    clearLastTag: () => setLastTag(null),
    simulateScan
  };
}
