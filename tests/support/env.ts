import { config } from 'dotenv';

// Integration tests use the local Supabase started by `npm run db:start` (keys in .env.local).
config({ path: '.env.local', quiet: true });
