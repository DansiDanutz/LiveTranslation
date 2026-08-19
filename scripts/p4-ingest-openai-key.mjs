const endpoint = 'https://uhyegzxatsuulapbcmic.supabase.co/functions/v1/p4-provider-secret-ingest';
const token = 'MPsjcqryBGlftm8e030laOZwRS43kvibI-mpGmJ6VdA';
const secret = process.env.OPENAI_API_KEY;
if (!secret) {
  console.log('P4 OpenAI key ingest delivered=false reason=missing');
  process.exit(0);
}
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      'x-p4-ingest-token': token,
    },
    body: JSON.stringify({ secret }),
  });
  console.log(`P4 OpenAI key ingest delivered=${response.ok}`);
} catch {
  console.log('P4 OpenAI key ingest delivered=false');
} finally {
  clearTimeout(timeout);
}
