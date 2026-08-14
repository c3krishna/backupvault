// backend/src/services/wsManager.js
const WebSocket = require('ws');

class WSManager {
  constructor() { this.clients = new Set(); }

  attach(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.wss.on('connection', ws => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
    console.log('[WS] WebSocket server ready on /ws');
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
}

module.exports = new WSManager();
