// FAKE OpenAI-compatible endpoint for local checks only — it is not a language model.
// It echoes how many server-tool results reached it, so you can see the assistant's
// tools → model path working without an API key:
//   pnpm dev:fake-llm            (listens on 0.0.0.0:54399)
//   LLM_BASE_URL=http://host.docker.internal:54399/v1 LLM_API_KEY=fake LLM_MODEL=fake pnpm functions:serve
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 54399);
createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const tools = (body.messages ?? []).filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
  const first = tools[0] ?? {};
  const content = `FAKE-LLM: получила ${tools.length} результат(а) инструментов до ответа; ${first.service ?? first.period ?? ''} ${first.first_free_day ?? first.money_received_net ?? ''}`.trim();
  console.log(new Date().toISOString(), req.url, 'model=', body.model, 'tools offered=', (body.tools ?? []).map((t) => t.function.name).join(','));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { total_tokens: 77 } }));
}).listen(port, '0.0.0.0', () => console.log('fake llm on', port));
