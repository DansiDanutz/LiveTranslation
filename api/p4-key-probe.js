export default function handler(_req, res) {
  res.setHeader('cache-control', 'no-store');
  return res.status(200).json({
    openai_api_key_configured: Boolean(process.env.OPENAI_API_KEY),
    plaintext_exposed: false,
  });
}
