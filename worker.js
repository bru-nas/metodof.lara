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

      // DEMO: bloqueia por IP
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

      // ALERTA DE DEVICE
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

      // MONTA O SYSTEM PROMPT AQUI NO WORKER
      const banca = body._banca || 'UFG';

      const CRIVO_UFG = `CRIVO OFICIAL DA UFG (Quadro 4):
- Adequação ao tema: 0 a 9 pontos
- Adequação ao gênero textual: 0 a 5 pontos
- Adequação à modalidade escrita (norma culta): 0 a 5 pontos
- Coesão e coerência: 0 a 5 pontos
TOTAL MÁXIMO: 24 pontos. A soma dos 4 critérios = nota_total.`;

      const crivoInfo = banca === 'UFG'
        ? CRIVO_UFG
        : `USE A BUSCA NA INTERNET para encontrar os critérios e pesos EXATOS e ATUAIS da banca ${banca}.`;

      const systemPrompt = isDemo
        ? `Você é um corretor especialista em redações de vestibular. Banca: ${banca}.
${banca === 'UFG' ? CRIVO_UFG : 'Busque os critérios oficiais da banca ' + banca + '.'}
Faça uma análise RÁPIDA (demonstração gratuita). Identifique:
- 1 ponto positivo genuíno segundo o crivo da ${banca}
- 1 ponto negativo principal segundo o crivo da ${banca}
Linguagem encorajadora para ensino médio. Cite o critério da ${banca} no detalhe.
RESPONDA APENAS com JSON válido, sem markdown:
{"nota_total":<n>,"nota_max":<máx real da ${banca}>,"banca":"${banca}","veredito":"frase encorajadora citando ${banca}","positivo":{"titulo":"...","detalhe":"cite o critério da ${banca}"},"negativo":{"titulo":"...","detalhe":"cite o critério da ${banca}"}}`
        : `Você é um corretor especialista em redações de vestibular. Banca: ${banca}.
${crivoInfo}
REGRAS OBRIGATÓRIAS:
1. Use SOMENTE os critérios oficiais listados acima.
2. Nota de cada critério não ultrapassa o máximo do critério.
3. Soma das notas = nota_total exatamente.
4. nota_total não ultrapassa nota_max.
5. NÃO transcreva o texto da redação.
6. Cite a banca ${banca} e o critério em cada comentário.
Se receber imagens, leia e avalie mas NÃO transcreva.
Avalie sob DOIS olhares:
1. CRIVO OFICIAL DA ${banca}: critérios exatos acima.
2. MODELO GERAL DISSERTATIVO: tese, desenvolvimento, conclusão.
RESPONDA APENAS com JSON válido, sem markdown:
{"nota_total":<soma exata>,"nota_max":<máx real>,"banca":"${banca}","veredito":"frase citando ${banca}","criterios":[{"nome":"critério exato","nota":<n>,"max":<máx>,"comentario":"cite ${banca}"}],"comparativo":"compare ${banca} vs modelo geral","pontos_atencao":[{"titulo":"...","detalhe":"..."}],"texto_marcado":"só trechos problemáticos entre <<erro>>...<</erro>>","edital_fonte":"..."}`;

      // remove flags internas
      delete body._demo;
      delete body._senha;
      delete body._device;
      delete body._banca;

      // injeta o system prompt
      body.system = systemPrompt;

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
