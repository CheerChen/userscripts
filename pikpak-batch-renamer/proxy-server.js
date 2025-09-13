const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3001;

const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // Get target URL from query parameters
    const parsedUrl = url.parse(req.url, true);
    const targetUrl = parsedUrl.query.url;
    
    if (!targetUrl) {
        res.writeHead(400);
        res.end('Missing url parameter');
        return;
    }
    
    console.log(`Proxying request: ${targetUrl}`);
    
    const requestModule = targetUrl.startsWith('https:') ? https : http;
    
    const proxyReq = requestModule.request(targetUrl, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
        console.error('Proxy request error:', err);
        res.writeHead(500);
        res.end('Proxy request failed');
    });
    
    if (req.method === 'POST') {
        req.pipe(proxyReq);
    } else {
        proxyReq.end();
    }
});

server.listen(PORT, () => {
    console.log(`🚀 CORS proxy server started: http://localhost:${PORT}`);
    console.log(`Usage: http://localhost:${PORT}?url=TARGET_URL`);
});