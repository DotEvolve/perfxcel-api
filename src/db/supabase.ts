import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
}

// Create a Supabase client with the service role key to bypass RLS for admin operations.
// We explicitly set the schema to 'perfxcel'.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: 'perfxcel',
  },
});
