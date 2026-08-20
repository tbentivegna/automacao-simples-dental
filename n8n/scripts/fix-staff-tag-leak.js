require('dotenv').config({ path: __dirname + '/../.env' });

const BASE_URL = process.env.N8N_BASE_URL;
const API_KEY = process.env.N8N_API_KEY;

const SANITIZE_LINE = 'const text = ($json.output ?? "").replace(/^\\s*\\[Equipe da cl\\u00ednica\\]:\\s*/i, "");';
const OLD_LINE = 'const text = $json.output ?? "";';

async function patchWorkflow(workflowId, label) {
  const getRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  if (!getRes.ok) throw new Error(`GET ${label} falhou: ${getRes.status} ${await getRes.text()}`);
  const wf = await getRes.json();

  const node = wf.nodes.find((n) => n.name === 'Extrai JSON');
  if (!node) throw new Error(`${label}: node "Extrai JSON" nao encontrado`);

  if (!node.parameters.jsCode.includes(OLD_LINE)) {
    if (node.parameters.jsCode.includes(SANITIZE_LINE)) {
      console.log(`${label}: ja estava aplicado, pulando.`);
      return;
    }
    throw new Error(`${label}: linha original nao encontrada no jsCode (pode ja ter mudado)`);
  }

  node.parameters.jsCode = node.parameters.jsCode.replace(OLD_LINE, SANITIZE_LINE);

  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
  };

  const putRes = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'X-N8N-API-KEY': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await putRes.json();
  if (!putRes.ok) throw new Error(`PUT ${label} falhou: ${putRes.status} ${JSON.stringify(body)}`);

  console.log(`${label}: aplicado com sucesso. active=${body.active}`);
}

async function main() {
  await patchWorkflow('K2xRqOwS0N0AcoqG', 'PROD (Lumi)');
  await patchWorkflow('yFSw0JMMD93EGZMa', 'DEV (Lumi - DEV)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
