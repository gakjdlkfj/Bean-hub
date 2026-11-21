const express = require('express');
const http = require('http');
const path = require('path');
const compression = require('compression');
const { PORT, PROXY_PREFIX, WS_PREFIX } = require('./config');
const apiRoutes = require('./routes/api');
const { authRouter, requireAuth } = require('./routes/auth');
const { createAdminRouter } = require('./routes/admin');
const store = require('./data/store');
const { handleProxyRequest } = require('./proxy/httpProxy');
const { createWebSocketProxy } = require('./proxy/wsProxy');
const { ChatHub } = require('./chat/wsChat');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(compression());

const chatHub = new ChatHub();
const wsProxy = createWebSocketProxy();

// Serve the injected client-side runtime hook
app.get('/__proxy_hook.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'proxy', 'clientHook.js'), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
});

// Authentication, Admin/Owner, Chat history, and Portal API routes
app.use('/api/auth', authRouter);
app.use('/api/admin', createAdminRouter(chatHub));
app.get('/api/chat/messages', requireAuth, (req, res) => {
  res.json({
    messages: store.getMessages(100),
    onlineCount: chatHub.getOnlineCount(),
    announcement: store.getSettings().announcement
  });
});
app.use('/api', apiRoutes);

// Web Proxy HTTP/HTTPS routes
app.use(PROXY_PREFIX.replace(/\/$/, ''), handleProxyRequest);

// Static frontend assets
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Fallback to index.html
app.get('*', (req, res) => {
  const indexFile = path.join(publicDir, 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err && !res.headersSent) {
      res.status(404).send('Not Found');
    }
  });
});

const server = http.createServer(app);

// Unified WebSocket upgrade router for Proxy (/ws-proxy) and Live Chat (/ws-chat)
server.on('upgrade', (req, socket, head) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (reqUrl.pathname === WS_PREFIX) {
    wsProxy.handleUpgrade(req, socket, head);
  } else if (reqUrl.pathname === '/ws-chat') {
    chatHub.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`\n  [Bean Proxy] Server listening on http://localhost:${PORT}`);
  console.log(`  [Bean Proxy] HTTP/HTTPS Proxy Prefix: ${PROXY_PREFIX}`);
  console.log(`  [Bean Proxy] WebSocket Proxy: ${WS_PREFIX}`);
  console.log(`  [Bean Proxy] Live Chat WebSocket: /ws-chat\n`);
});
