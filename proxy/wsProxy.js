const WebSocket = require('ws');
const { USER_AGENTS, decodeProxyUrl } = require('../config');
const { cookieJar, parseSimpleCookies } = require('./cookieJar');

function createWebSocketProxy() {
  const wss = new WebSocket.Server({ noServer: true });

  function handleUpgrade(req, socket, head) {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const encodedTarget = reqUrl.searchParams.get('target');
    if (!encodedTarget) {
      socket.destroy();
      return;
    }

    let targetUrl;
    try {
      targetUrl = decodeProxyUrl(encodedTarget);
      if (!/^wss?:\/\//i.test(targetUrl)) {
        throw new Error('Invalid WS protocol');
      }
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const targetObj = new URL(targetUrl);
      const cookies = parseSimpleCookies(req.headers.cookie || '');
      const sid = cookies.proxy_sid;
      const cookieHeader = sid ? cookieJar.getCookieHeader(sid, targetUrl) : '';
      const ua =
        (cookies.proxy_ua && USER_AGENTS[cookies.proxy_ua]?.value) ||
        USER_AGENTS.chrome_win.value;

      const upstreamHeaders = {
        Origin: targetObj.origin.replace(/^ws/, 'http'),
        'User-Agent': ua
      };
      if (cookieHeader) {
        upstreamHeaders.Cookie = cookieHeader;
      }

      const upstreamWs = new WebSocket(targetUrl, {
        headers: upstreamHeaders
      });

      const pendingMessages = [];

      upstreamWs.on('open', () => {
        while (pendingMessages.length > 0) {
          const msg = pendingMessages.shift();
          upstreamWs.send(msg.data, { binary: msg.isBinary });
        }
      });

      clientWs.on('message', (data, isBinary) => {
        if (upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(data, { binary: isBinary });
        } else if (upstreamWs.readyState === WebSocket.CONNECTING) {
          pendingMessages.push({ data, isBinary });
        }
      });

      upstreamWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      clientWs.on('close', (code, reason) => {
        if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
          upstreamWs.close(code >= 1000 && code <= 4999 ? code : 1000, reason.toString());
        }
      });

      upstreamWs.on('close', (code, reason) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(code >= 1000 && code <= 4999 ? code : 1000, reason.toString());
        }
      });

      clientWs.on('error', () => upstreamWs.terminate());
      upstreamWs.on('error', () => clientWs.terminate());
    });
  }

  return { wss, handleUpgrade };
}

module.exports = {
  createWebSocketProxy
};
