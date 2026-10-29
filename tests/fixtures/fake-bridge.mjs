// Speaks the corel-bridge.ps1 line protocol without CorelDRAW, for BridgeProcess unit tests.
import { createInterface } from 'node:readline'

const send = (obj) => process.stdout.write('CFB1 ' + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64') + '\n')

if (process.argv.includes('--never-ready')) {
  setInterval(() => {}, 1000)
} else {
  send({ id: 0, ok: true, data: { ready: true } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(Buffer.from(line.trim(), 'base64').toString('utf8'))
  const { id, cmd, args } = req
  switch (cmd) {
    case 'echo':
      send({ id, ok: true, data: args })
      break
    case 'fail':
      send({ id, ok: false, error: { code: 'COREL_ERROR', message: 'Simulated failure' } })
      break
    case 'sleep':
      setTimeout(() => send({ id, ok: true, data: { slept: args.ms } }), args.ms)
      break
    case 'noise':
      process.stdout.write('WARNING: some console noise\n')
      send({ id, ok: true, data: { pid: process.pid } })
      break
    case 'pid':
      send({ id, ok: true, data: { pid: process.pid } })
      break
    case 'crash':
      process.exit(3)
      break
    case 'shutdown':
      send({ id, ok: true, data: { bye: true } })
      process.exit(0)
      break
    default:
      send({ id, ok: false, error: { code: 'UNKNOWN_COMMAND', message: cmd } })
  }
})
