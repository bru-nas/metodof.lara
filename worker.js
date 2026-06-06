export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const body = await request.json();
      const isDemo = body._demo === true;

      // ── DEMO: bloqueia por IP ──
      if (isDemo) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const key = 'demo_ip_' + ip;
        const jaUsou = await env.DEMO_KV.get(key);
        if (jaUsou) {
          return new Response(JSON.stringify({ _demo_bloqueado: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        await env.DEMO_KV.put(key, '1', { expirationTtl: 2592000 });
      }

      // ── ALERTA DE DEVICE ──
      const senha = body._senha || null;
      const deviceId = body._device || null;
      let deviceAlerta = false;

      if (senha && deviceId && !isDemo) {
        const deviceKey = 'device_' + senha;
        const deviceSalvo = await env.DEMO_KV.get(deviceKey);
        if (!deviceSalvo) {
          await env.DEMO_KV.put(deviceKey, deviceId);
        } else if (deviceSalvo !== deviceId) {
          await env.DEMO_KV.put('alerta_' + senha, JSON.stringify({
            quando: new Date().toISOString(),
            ip: request.headers.get('CF-Connecting-IP') || 'unknown'
          }));
          deviceAlerta = true;
        }
      }

      // ── SYSTEM PROMPT ──
      const banca = body._banca || 'UFG';

      const CRIVO_UFG = `CRIVO OFICIAL DA UFG (Quadro 4 do edital):
- Adequação ao tema: 0 a 9 pontos
- Adequação ao gênero textual: 0 a 5 pontos
- Adequação à modalidade escrita (norma culta): 0 a 5 pontos
- Coesão e coerência: 0 a 5 pontos
TOTAL MÁXIMO: 24 pontos.`;

      const crivoInfo = banca === 'UFG'
        ? CRIVO_UFG
        : `Pesquise na internet os critérios e pesos EXATOS e ATUAIS da banca ${banca} antes de corrigir.`;

      const systemDemo = `Você é um corretor especialista em redações de vestibular.
Banca avaliada: ${banca}.
${banca === 'UFG' ? CRIVO_UFG : 'Busque os critérios oficiais da banca ' + banca + '.'}

Faça uma análise RÁPIDA (modo demonstração gratuita).
Identifique obrigatoriamente:
- 1 ponto positivo genuíno baseado no crivo da ${banca}
- 1 ponto negativo principal baseado no crivo da ${banca}

Use linguagem encorajadora para aluno do ensino médio.
Mencione o nome do critério da ${banca} na explicação.

Responda SOMENTE com este JSON válido, sem markdown, sem texto antes ou depois:
{
  "nota_total": <número estimado conforme crivo da ${banca}>,
  "nota_max": <nota máxima real da banca ${banca}>,
  "banca": "${banca}",
  "veredito": "<frase curta encorajadora citando a banca ${banca}>",
  "positivo": {
    "titulo": "<título do ponto positivo>",
    "detalhe": "<explicação de 2-3 linhas citando o critério da ${banca}>"
  },
  "negativo": {
    "titulo": "<título do ponto a melhorar>",
    "detalhe": "<explicação de 2-3 linhas citando o critério da ${banca}>"
  }
}`;

      const systemCompleto = `Você é um corretor especialista em redações de vestibular.
Banca avaliada: ${banca}.

${crivoInfo}

REGRAS OBRIGATÓRIAS — SIGA À RISCA:
1. Use SOMENTE os critérios oficiais da banca ${banca} listados acima.
2. A nota de cada critério não pode ultrapassar o máximo daquele critério.
3. A soma das notas dos critérios deve ser EXATAMENTE igual a nota_total.
4. nota_total nunca ultrapassa nota_max.
5. NÃO transcreva nem repita o texto da redação na resposta.
6. Cite a banca ${banca} e o critério específico em cada comentário.
7. pontos_atencao deve ter SEMPRE no mínimo 2 itens — mesmo que a redação seja boa, aponte o que pode melhorar.
8. texto_marcado deve conter APENAS os trechos problemáticos marcados entre <<erro>> e <</erro>>, não o texto inteiro.
9. Se receber imagens (manuscrito), leia e avalie — mas NÃO transcreva.

Avalie sob DOIS olhares e compare:
1. CRIVO OFICIAL DA ${banca}: use exatamente os critérios e pesos acima.
2. MODELO GERAL DISSERTATIVO-ARGUMENTATIVO: introdução/tese, desenvolvimento/argumentação, conclusão/proposta.

Responda SOMENTE com este JSON válido, sem markdown, sem texto antes ou depois:
{
  "nota_total": <soma exata das notas dos critérios>,
  "nota_max": <nota máxima real da banca ${banca}>,
  "banca": "${banca}",
  "veredito": "<frase curta avaliativa citando a banca ${banca}>",
  "criterios": [
    {
      "nome": "<nome exato do critério da ${banca}>",
      "nota": <nota atribuída>,
      "max": <pontuação máxima do critério>,
      "comentario": "<comentário detalhado citando a ${banca} e o critério>"
    }
  ],
  "comparativo": "<análise comparando o crivo da ${banca} com o modelo geral dissertativo-argumentativo>",
  "pontos_atencao": [
    {
      "titulo": "<título do ponto de atenção>",
      "detalhe": "<explicação detalhada do problema ou aspecto a melhorar>"
    }
  ],
  "texto_marcado": "<apenas os trechos problemáticos entre <<erro>>trecho<</erro>>, não o texto inteiro>",
  "edital_fonte": "<edital ou fonte consultada>"
}`;

      // remove flags internas
      delete body._demo;
      delete body._senha;
      delete body._device;
      delete body._banca;

      // injeta o system prompt montado no Worker
      body.system = isDemo ? systemDemo : systemCompleto;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (deviceAlerta) data._device_alerta = true;

      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
