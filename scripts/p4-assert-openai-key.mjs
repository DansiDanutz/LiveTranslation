const openaiPresent = Boolean(process.env.OPENAI_API_KEY);
const oidcPresent = Boolean(process.env.VERCEL_OIDC_TOKEN);
console.log(`P4_OPENAI_KEY_PRESENT=${openaiPresent}`);
console.log(`P4_VERCEL_OIDC_PRESENT=${oidcPresent}`);
if (!openaiPresent) process.exit(42);
if (!oidcPresent) process.exit(43);
