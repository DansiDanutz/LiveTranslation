const endpoint = 'https://uhyegzxatsuulapbcmic.supabase.co/functions/v1/p4-provider-probe-receiver';
const token = 'hB5mC66teiGltlzWJVl8Hk0F4BuMrZJhlbo1bTDrTA0';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      'x-p4-probe-token': token,
    },
    body: JSON.stringify({
      source: 'livetranslation-preview',
      keyConfigured: Boolean(process.env.OPENAI_API_KEY),
    }),
  });
  console.log(`P4 preview env probe delivered=${response.ok}`);
} catch {
  console.log('P4 preview env probe delivered=false');
} finally {
  clearTimeout(timeout);
}
