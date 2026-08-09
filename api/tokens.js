import { getPumpFunToken } from './lib/pumpfun.js'

const send = (response, status, body) => response.status(status).json(body)

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return send(response, 405, { error: 'Method not allowed.' })
  }

  try {
    const token = await getPumpFunToken(request.query?.mint)
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
    return send(response, 200, { token })
  } catch (error) {
    const status = error.status ?? 500
    if (status >= 500) console.error('Pump.fun token lookup error', error)
    return send(response, status, { error: status >= 500 ? 'Unable to look up the token right now.' : error.message })
  }
}
