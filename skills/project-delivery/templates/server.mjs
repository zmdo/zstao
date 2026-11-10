import { createServer } from 'node:http'

createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ ok: true, application: 'harness-delivery-demo', version: 1 }))
}).listen(8080, '0.0.0.0')
