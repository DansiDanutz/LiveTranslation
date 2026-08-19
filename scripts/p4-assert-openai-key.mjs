const present = Boolean(process.env.OPENAI_API_KEY);
console.log(`P4_OPENAI_KEY_PRESENT=${present}`);
if (!present) process.exit(42);
