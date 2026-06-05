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
      return new Response('Método F. Lara API — OK', { status: 200 });
    }

    try {
      const body = await request.json();
      const isDemo = body._demo === true;

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

      delete body._demo;
      delete body._senha;
      delete body._device;

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
