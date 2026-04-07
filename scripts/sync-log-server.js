const http = require('http')
const fs = require('fs')
const path = require('path')
const logFile = path.join(__dirname, '..', 'mobile-sync-dev.log')
http
  .createServer((req, res) => {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk.toString()))
      req.on('end', () => {
        fs.appendFileSync(logFile, body + '\n')
        res.writeHead(200)
        res.end('Logged')
      })
    } else {
      res.writeHead(200)
      res.end('Sync Log Server Running')
    }
  })
  .listen(8099, () =>
    console.log('App Sync Log Server listening on port 8099... Logs will be saved to mobile-sync-dev.log')
  )
